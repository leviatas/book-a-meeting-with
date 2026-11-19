const { OAuth2Client } = require('google-auth-library');
const { DateTime } = require('luxon');
const prisma = require('./prisma');
const { encrypt, decrypt } = require('./crypto');
const { parseJson } = require('./serialize');

// Integración con Google Calendar. Es un flujo OAuth APARTE del login: el
// login usa Google Identity Services (sólo ID token, sin scopes), y acá se pide
// un authorization code con access_type=offline para quedarse con un refresh
// token y poder leer la disponibilidad / crear eventos sin que la persona esté
// presente (el invitado reserva a cualquier hora).
const SCOPES = [
  'openid',
  'email',
  // calendarList + freeBusy de todos los calendarios del usuario.
  'https://www.googleapis.com/auth/calendar.readonly',
  // Crear / mover / borrar el evento de la reserva.
  'https://www.googleapis.com/auth/calendar.events',
];

const API = 'https://www.googleapis.com/calendar/v3';

function isEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function publicOrigin() {
  return (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
}

// Tiene que estar cargada TAL CUAL en "Authorized redirect URIs" del Client ID.
// Por default es el origen público + /api/google/callback (nginx lo proxea; en
// dev lo proxea Vite).
function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${publicOrigin()}/api/google/callback`;
}

function baseClient() {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri());
}

function authUrl(state) {
  return baseClient().generateAuthUrl({
    access_type: 'offline',
    // prompt=consent fuerza a Google a devolver refresh_token aunque la persona
    // ya haya autorizado antes (si no, sólo lo da la primera vez).
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });
}

async function exchangeCode(code) {
  const client = baseClient();
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return { tokens, email: ticket.getPayload().email };
}

async function saveConnection(userId, tokens, email) {
  const existing = await prisma.googleConnection.findUnique({ where: { userId } });
  const refresh = tokens.refresh_token || (existing && decrypt(existing.refreshTokenEnc));
  if (!refresh) throw new Error('Google no devolvió refresh token. Reintentá la conexión.');

  const data = {
    googleEmail: email,
    refreshTokenEnc: encrypt(refresh),
    accessTokenEnc: encrypt(tokens.access_token),
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    lastError: null,
  };
  return prisma.googleConnection.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

function clientFor(connection) {
  const client = baseClient();
  client.setCredentials({
    refresh_token: decrypt(connection.refreshTokenEnc),
    access_token: decrypt(connection.accessTokenEnc) || undefined,
    expiry_date: connection.expiryDate ? connection.expiryDate.getTime() : undefined,
  });
  // google-auth-library refresca solo cuando expira el access token; acá se
  // persiste el nuevo para no pedir uno por request.
  client.on('tokens', (t) => {
    prisma.googleConnection
      .update({
        where: { id: connection.id },
        data: {
          accessTokenEnc: encrypt(t.access_token),
          expiryDate: t.expiry_date ? new Date(t.expiry_date) : null,
          ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token) } : {}),
        },
      })
      .catch((err) => console.error('No se pudo guardar el token de Google', err));
  });
  return client;
}

async function gRequest(connection, opts) {
  try {
    const res = await clientFor(connection).request(opts);
    if (connection.lastError) {
      await prisma.googleConnection.update({ where: { id: connection.id }, data: { lastError: null } });
    }
    return res.data;
  } catch (err) {
    const data = err && err.response && err.response.data;
    const message = (data && data.error && (data.error.message || data.error_description)) || err.message;
    console.error(`Google Calendar (${opts.method || 'GET'} ${opts.url}):`, message);
    await prisma.googleConnection
      .update({ where: { id: connection.id }, data: { lastError: String(message).slice(0, 500) } })
      .catch(() => {});
    throw err;
  }
}

function conflictCalendarIds(connection) {
  const ids = parseJson(connection.conflictCalendarIdsJson, ['primary']);
  return Array.isArray(ids) ? ids : ['primary'];
}

async function listCalendars(connection) {
  const data = await gRequest(connection, {
    url: `${API}/users/me/calendarList`,
    params: { minAccessRole: 'freeBusyReader', maxResults: 250 },
  });
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary,
    primary: Boolean(c.primary),
    accessRole: c.accessRole,
    backgroundColor: c.backgroundColor,
  }));
}

// FreeBusy combina eventos superpuestos. En un calendario que contiene el
// propio turno consultamos los eventos para distinguirlo de otra reunión.
async function busyExceptOwn(connection, calendarId, timeMin, timeMax, ownEvents) {
  const busy = [];
  let pageToken;
  do {
    const data = await gRequest(connection, {
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
      params: {
        timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: true,
        fields: 'nextPageToken,timeZone,items(id,start,end,transparency,status,attendees(self,responseStatus))',
        maxResults: 250, pageToken,
      },
    });
    for (const event of data.items || []) {
      if (event.status === 'cancelled' || event.transparency === 'transparent') continue;
      if (event.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
      const endpoint = (value) => DateTime.fromISO(value.dateTime || value.date, { zone: value.timeZone || data.timeZone }).toJSDate();
      const start = endpoint(event.start);
      const end = endpoint(event.end);
      const own = ownEvents.get(event.id);
      if (own && (own.ignore || (+start === +own.start && +end === +own.end))) continue;
      busy.push({ start, end });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return busy;
}

async function freeBusy(connection, timeMin, timeMax, ownBookings = []) {
  const ids = conflictCalendarIds(connection);
  if (ids.length === 0) return [];
  const data = await gRequest(connection, {
    url: `${API}/freeBusy`,
    method: 'POST',
    data: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: ids.map((id) => ({ id })),
    },
  });
  const busy = [];
  const primaryId = (id) => id === 'primary' ? connection.googleEmail : id;
  for (const [id, cal] of Object.entries(data.calendars || {})) {
    if (!cal.busy?.length) continue;
    const ownEvents = new Map();
    for (const b of ownBookings) {
      if (primaryId(b.googleCalendarId || 'primary') !== primaryId(id)) continue;
      ownEvents.set(b.googleEventId, { start: b.startTime, end: b.endTime, ignore: b.ignore });
      if (b.ignore) {
        for (const bufferId of parseJson(b.googleBufferIdsJson, [])) ownEvents.set(bufferId, { ignore: true });
      }
    }
    if (ownEvents.size) {
      try {
        busy.push(...await busyExceptOwn(connection, id, timeMin, timeMax, ownEvents));
        continue;
      } catch {
        // Sin el detalle, conservamos los bloques que Google ya devolvió.
      }
    }
    for (const b of cal.busy || []) busy.push({ start: new Date(b.start), end: new Date(b.end) });
  }
  return busy;
}

// Invitado + sus invitados adicionales, como asistentes de Google.
function bookingAttendees(booking) {
  const guests = parseJson(booking.guestsJson, []);
  return [
    { email: booking.inviteeEmail, displayName: booking.inviteeName },
    ...guests.map((email) => ({ email })),
  ];
}

function eventBody({ booking, eventType, host, manageUrl }) {
  const isGroup = eventType.kind === 'group';
  const description = [
    eventType.description,
    // En un grupal el evento es de todos: no lleva datos ni link de un invitado.
    isGroup ? null : `Reservado por ${booking.inviteeName} <${booking.inviteeEmail}>`,
    !isGroup && booking.notes ? `Notas: ${booking.notes}` : null,
    !isGroup && manageUrl ? `Reprogramar o cancelar: ${manageUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const body = {
    summary: isGroup ? `${eventType.title} (${host.name})` : `${eventType.title}: ${booking.inviteeName} y ${host.name}`,
    description,
    start: { dateTime: booking.startTime.toISOString() },
    end: { dateTime: booking.endTime.toISOString() },
    attendees: [{ email: host.email, organizer: true, responseStatus: 'accepted' }, ...bookingAttendees(booking)],
    // Marca para reconocer los eventos de la app al sincronizar.
    extendedProperties: { private: { bookameeting: isGroup ? `group:${eventType.id}` : booking.uid } },
  };
  if (booking.location) body.location = booking.location;
  if (eventType.locationType === 'google_meet') {
    body.conferenceData = {
      createRequest: { requestId: booking.uid, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  return body;
}

async function createEvent(connection, ctx) {
  const calendarId = connection.targetCalendarId || 'primary';
  const data = await gRequest(connection, {
    url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
    method: 'POST',
    // sendUpdates=all: Google le manda la invitación al invitado.
    params: { conferenceDataVersion: 1, sendUpdates: 'all' },
    data: eventBody(ctx),
  });
  return { calendarId, eventId: data.id, meetLink: data.hangoutLink || null };
}

async function moveEvent(connection, calendarId, eventId, startTime, endTime) {
  return gRequest(connection, {
    url: `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    method: 'PATCH',
    params: { sendUpdates: 'all' },
    data: { start: { dateTime: startTime.toISOString() }, end: { dateTime: endTime.toISOString() } },
  });
}

async function deleteEvent(connection, calendarId, eventId) {
  return gRequest(connection, {
    url: `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    method: 'DELETE',
    params: { sendUpdates: 'all' },
  });
}

function eventUrl(calendarId, eventId) {
  return `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

// Grupales: todas las reservas del turno comparten un evento. Sumar o quitar
// invitados reescribe la lista de asistentes (Google no tiene "append").
async function addAttendees(connection, calendarId, eventId, booking) {
  const event = await gRequest(connection, { url: eventUrl(calendarId, eventId) });
  const current = event.attendees || [];
  const emails = new Set(current.map((a) => a.email.toLowerCase()));
  const extra = bookingAttendees(booking).filter((a) => !emails.has(a.email.toLowerCase()));
  if (extra.length === 0) return event;
  return gRequest(connection, {
    url: eventUrl(calendarId, eventId),
    method: 'PATCH',
    params: { sendUpdates: 'all' },
    data: { attendees: [...current, ...extra] },
  });
}

async function removeAttendees(connection, calendarId, eventId, booking, remainingBookings) {
  const event = await gRequest(connection, { url: eventUrl(calendarId, eventId) });
  const drop = new Set(bookingAttendees(booking).map((a) => a.email.toLowerCase()));
  for (const other of remainingBookings) {
    for (const attendee of bookingAttendees(other)) drop.delete(attendee.email.toLowerCase());
  }
  return gRequest(connection, {
    url: eventUrl(calendarId, eventId),
    method: 'PATCH',
    params: { sendUpdates: 'all' },
    data: { attendees: (event.attendees || []).filter((a) => a.organizer || !drop.has(a.email.toLowerCase())) },
  });
}

// "Include buffers on this calendar": bloques sin invitados antes/después.
async function createBufferEvents(connection, { booking, eventType }) {
  const calendarId = booking.googleCalendarId || connection.targetCalendarId || 'primary';
  const blocks = [];
  if (eventType.bufferBefore) {
    blocks.push([new Date(booking.startTime.getTime() - eventType.bufferBefore * 60000), booking.startTime]);
  }
  if (eventType.bufferAfter) {
    blocks.push([booking.endTime, new Date(booking.endTime.getTime() + eventType.bufferAfter * 60000)]);
  }
  const ids = [];
  for (const [start, end] of blocks) {
    const data = await gRequest(connection, {
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
      method: 'POST',
      data: {
        summary: `Margen: ${eventType.title}`,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        transparency: 'opaque',
        extendedProperties: { private: { bookameetingBuffer: booking.uid } },
      },
    }).catch(() => null);
    if (data) ids.push(data.id);
  }
  return ids;
}

async function deleteEventsQuiet(connection, calendarId, ids) {
  for (const id of ids) {
    await gRequest(connection, { url: eventUrl(calendarId, id), method: 'DELETE' }).catch(() => {});
  }
}

// Eventos modificados (incluidos los borrados) desde `updatedMin`.
async function listChangedEvents(connection, calendarId, updatedMin) {
  const items = [];
  let pageToken;
  do {
    const data = await gRequest(connection, {
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
      params: {
        updatedMin: updatedMin.toISOString(),
        showDeleted: true,
        singleEvents: true,
        maxResults: 250,
        ...(pageToken ? { pageToken } : {}),
      },
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

async function revoke(connection) {
  try {
    await baseClient().revokeToken(decrypt(connection.refreshTokenEnc));
  } catch (e) {
    /* best effort: si ya estaba revocado, igual se borra local */
  }
}

module.exports = {
  isEnabled,
  publicOrigin,
  redirectUri,
  authUrl,
  exchangeCode,
  saveConnection,
  listCalendars,
  freeBusy,
  createEvent,
  moveEvent,
  deleteEvent,
  addAttendees,
  removeAttendees,
  createBufferEvents,
  deleteEventsQuiet,
  listChangedEvents,
  revoke,
  conflictCalendarIds,
};
