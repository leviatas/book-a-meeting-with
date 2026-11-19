const { DateTime } = require('luxon');
const prisma = require('./prisma');
const google = require('./google');
const { notifyBooking } = require('./mailer');
const { isSlotAvailable, isValidZone, hostZoneFor } = require('./availability');
const { randomUid } = require('./crypto');
const { parseJson, enabledQuestions } = require('./serialize');

// Lógica de reservas compartida por la página pública (invitado), el panel
// (host) y la sincronización con Google (lib/jobs.js). Las rutas sólo validan
// permisos y llaman acá.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Candado en memoria por host: entre "¿está libre?" y "guardar" no puede
// meterse otra reserva del mismo host. Alcanza porque el stack corre UNA sola
// instancia del server (ver CLAUDE.md); con réplicas haría falta un lock en la
// base.
const locks = new Map();
async function withHostLock(hostId, fn) {
  const previous = locks.get(hostId) || Promise.resolve();
  let release;
  const current = new Promise((r) => (release = r));
  const chained = previous.then(() => current);
  locks.set(hostId, chained);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(hostId) === chained) locks.delete(hostId);
  }
}

function manageUrl(uid) {
  return `${google.publicOrigin()}/reserva/${uid}`;
}

function resolveLocation(eventType) {
  switch (eventType.locationType) {
    case 'phone':
      return eventType.locationValue ? `Teléfono: ${eventType.locationValue}` : 'Llamada telefónica';
    case 'in_person':
    case 'custom':
      return eventType.locationValue || null;
    default:
      return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_GUESTS = 10;

function cleanAnswer(q, raw) {
  const values = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
    .map((v) => String(v).trim().slice(0, 2000))
    .filter(Boolean);

  if (['radio', 'select', 'checkbox'].includes(q.type)) {
    // Sólo valores de la lista, salvo que la pregunta acepte "Otro" (el
    // cliente lo manda como "Otro: <texto>").
    for (const v of values) {
      const ok = q.options.includes(v) || (q.allowOther && v.startsWith('Otro: ') && v.length > 6);
      if (!ok) throw new HttpError(400, `Respuesta inválida en: ${q.label}`);
    }
    if (q.type !== 'checkbox' && values.length > 1) throw new HttpError(400, `Elegí una sola opción en: ${q.label}`);
    return values.join(', ');
  }
  return values[0] || '';
}

function validateInvitee(eventType, input) {
  const name = String(input.name || '').trim().slice(0, 120);
  const email = String(input.email || '').trim().toLowerCase().slice(0, 200);
  const timezone = String(input.timezone || '');
  if (!name) throw new HttpError(400, 'El nombre es obligatorio');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'El email no es válido');
  if (!isValidZone(timezone)) throw new HttpError(400, 'Zona horaria inválida');

  const rawAnswers = input.answers && typeof input.answers === 'object' ? input.answers : {};
  const answers = {};
  for (const q of enabledQuestions(eventType)) {
    const value = cleanAnswer(q, rawAnswers[q.id]);
    if (q.required && !value) throw new HttpError(400, `Falta responder: ${q.label}`);
    if (value) answers[q.id] = value;
  }

  let guests = [];
  if (eventType.allowGuests && Array.isArray(input.guests)) {
    guests = [...new Set(input.guests.map((g) => String(g).trim().toLowerCase()).filter(Boolean))];
    if (guests.length > MAX_GUESTS) throw new HttpError(400, `Podés sumar hasta ${MAX_GUESTS} invitados`);
    const bad = guests.find((g) => !EMAIL_RE.test(g));
    if (bad) throw new HttpError(400, `El email ${bad} no es válido`);
    guests = guests.filter((g) => g !== email);
  }

  const notes = String(input.notes || '').trim().slice(0, 2000) || null;
  return { name, email, timezone, answers, guests, notes };
}

function parseStart(startIso) {
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' });
  if (!start.isValid) throw new HttpError(400, 'Horario inválido');
  return start.set({ second: 0, millisecond: 0 });
}

// ---- Google: enganchar / desenganchar una reserva de su evento ------------

async function connectionFor(hostId) {
  if (!google.isEnabled()) return null;
  return prisma.googleConnection.findUnique({ where: { userId: hostId } });
}

// Otra reserva confirmada del mismo grupal y mismo turno que ya tiene evento.
function findGroupSibling(booking) {
  return prisma.booking.findFirst({
    where: {
      eventTypeId: booking.eventTypeId,
      startTime: booking.startTime,
      status: 'CONFIRMED',
      googleEventId: { not: null },
      NOT: { id: booking.id },
    },
  });
}

async function attachToGoogle(booking, eventType, host) {
  const connection = await connectionFor(host.id);
  if (!connection) return booking;
  try {
    if (eventType.kind === 'group') {
      const sibling = await findGroupSibling(booking);
      if (sibling) {
        await google.addAttendees(connection, sibling.googleCalendarId || 'primary', sibling.googleEventId, booking);
        return prisma.booking.update({
          where: { id: booking.id },
          data: { googleCalendarId: sibling.googleCalendarId, googleEventId: sibling.googleEventId, meetLink: sibling.meetLink },
        });
      }
    }
    const created = await google.createEvent(connection, { booking, eventType, host, manageUrl: manageUrl(booking.uid) });
    let bufferIds = [];
    // Los márgenes en el calendario sólo para individuales: en un grupal el
    // evento es compartido y no hay una reserva "dueña" de los bloques.
    if (connection.includeBuffers && eventType.kind !== 'group') {
      bufferIds = await google.createBufferEvents(connection, { booking, eventType }).catch(() => []);
    }
    return prisma.booking.update({
      where: { id: booking.id },
      data: {
        googleCalendarId: created.calendarId,
        googleEventId: created.eventId,
        meetLink: created.meetLink,
        googleBufferIdsJson: JSON.stringify(bufferIds),
      },
    });
  } catch (err) {
    // La reserva ya está guardada y el horario bloqueado en la app; que Google
    // falle no puede dejar al invitado sin confirmación. El error queda en
    // GoogleConnection.lastError.
    return booking;
  }
}

async function detachFromGoogle(booking, { eventAlreadyDeleted = false } = {}) {
  if (!booking.googleEventId) return;
  const connection = await connectionFor(booking.hostId);
  if (!connection) return;
  const calendarId = booking.googleCalendarId || 'primary';
  await google.deleteEventsQuiet(connection, calendarId, parseJson(booking.googleBufferIdsJson, []));
  if (eventAlreadyDeleted) return;
  const others = await prisma.booking.findMany({
    where: { hostId: booking.hostId, googleCalendarId: booking.googleCalendarId, googleEventId: booking.googleEventId, status: 'CONFIRMED', NOT: { id: booking.id } },
    select: { inviteeEmail: true, guestsJson: true },
  });
  try {
    if (others.length > 0) await google.removeAttendees(connection, calendarId, booking.googleEventId, booking, others);
    else await google.deleteEvent(connection, calendarId, booking.googleEventId);
  } catch (e) {
    /* ya registrado en lastError */
  }
}

// ---- Operaciones ----------------------------------------------------------

// Serializa también los cambios en Calendar: los invitados de un mismo
// grupal tienen que terminar en el mismo evento. El SMTP queda fuera del lock.
async function changeBooking(hostId, kind, change) {
  const { booking, eventType, host } = await withHostLock(hostId, change);
  await notifyBooking(kind, { booking, eventType, host, manageUrl: manageUrl(booking.uid), hostZone: await hostZoneFor(eventType) });
  return booking;
}

async function createBooking(requestedType, input, { linkToken } = {}) {
  const start = parseStart(input.start);
  return changeBooking(requestedType.userId, 'created', async () => {
    if (linkToken) {
      const link = await prisma.singleUseLink.findUnique({ where: { token: linkToken } });
      if (!link || link.eventTypeId !== requestedType.id) throw new HttpError(404, 'El link no es válido');
      if (link.usedAt) throw new HttpError(410, 'Este link ya se usó para agendar una reunión');
    }
    const eventType = await prisma.eventType.findUnique({
      where: { id: requestedType.id },
      include: { user: true, schedule: true },
    });
    if (!eventType || !eventType.isActive) throw new HttpError(404, 'Este evento no está disponible');
    const invitee = validateInvitee(eventType, input);
    if (!(await isSlotAvailable(eventType, start.toISO(), { requiredSeats: 1 + invitee.guests.length }))) {
      if (eventType.kind === 'group') throw new HttpError(409, 'Ya no quedan suficientes lugares en ese horario.');
      throw new HttpError(409, 'Ese horario ya no está disponible. Elegí otro.');
    }
    const created = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          uid: randomUid(),
          companyId: eventType.companyId,
          eventTypeId: eventType.id,
          hostId: eventType.userId,
          startTime: start.toJSDate(),
          endTime: start.plus({ minutes: eventType.durationMinutes }).toJSDate(),
          inviteeName: invitee.name,
          inviteeEmail: invitee.email,
          inviteeTimezone: invitee.timezone,
          guestsJson: JSON.stringify(invitee.guests),
          answersJson: JSON.stringify(invitee.answers),
          notes: invitee.notes,
          location: resolveLocation(eventType),
        },
      });
      if (linkToken) {
        const consumed = await tx.singleUseLink.updateMany({
          where: { token: linkToken, eventTypeId: eventType.id, usedAt: null },
          data: { usedAt: new Date(), bookingId: booking.id },
        });
        if (!consumed.count) throw new HttpError(410, 'Este link ya no está disponible');
      }
      if (eventType.kind === 'one_off') {
        await tx.eventType.update({ where: { id: eventType.id }, data: { isActive: false } });
      }
      return booking;
    });
    const booking = await attachToGoogle(created, eventType, eventType.user);
    return { booking, eventType, host: eventType.user };
  });
}

async function loadUpcoming(id) {
  const booking = await prisma.booking.findUnique({ where: { id }, include: { eventType: true, host: true } });
  if (!booking) throw new HttpError(404, 'No encontramos esa reserva');
  if (booking.status !== 'CONFIRMED') throw new HttpError(409, 'La reserva ya está cancelada');
  if (booking.startTime <= new Date()) throw new HttpError(409, 'La reunión ya pasó');
  return booking;
}

async function rescheduleBooking(requestedBooking, startIso) {
  const start = parseStart(startIso);
  return changeBooking(requestedBooking.hostId, 'rescheduled', async () => {
    const booking = await loadUpcoming(requestedBooking.id);
    const { eventType, host } = booking;
    if (!eventType.isActive && eventType.kind !== 'one_off') {
      throw new HttpError(409, 'Este tipo de evento ya no está disponible');
    }
    // La reserva de una reunión única puede elegir entre los horarios originales.
    const check = eventType.isActive ? eventType : { ...eventType, isActive: true };
    const requiredSeats = 1 + parseJson(booking.guestsJson, []).length;
    if (!(await isSlotAvailable(check, start.toISO(), { excludeBookingId: booking.id, requiredSeats }))) {
      throw new HttpError(409, 'Ese horario ya no está disponible. Elegí otro.');
    }
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startTime: start.toJSDate(),
        endTime: start.plus({ minutes: eventType.durationMinutes }).toJSDate(),
        rescheduleCount: { increment: 1 },
        // Los recordatorios se recalculan para el horario nuevo.
        remindersSentJson: '[]',
      },
    });
    const saved = await moveInGoogle(booking, updated, eventType, host);
    return { booking: saved, eventType, host };
  });
}

async function moveInGoogle(booking, updated, eventType, host) {
  let saved = updated;
  if (eventType.kind === 'group') {
    // En un grupal mover el evento movería a todos: se sale del turno viejo y
    // se suma (o crea) el nuevo.
    await detachFromGoogle(booking);
    saved = await prisma.booking.update({
      where: { id: updated.id },
      data: { googleEventId: null, googleCalendarId: null, meetLink: null, googleBufferIdsJson: '[]' },
    });
    saved = await attachToGoogle(saved, eventType, host);
  } else if (updated.googleEventId) {
    const connection = await connectionFor(host.id);
    if (connection) {
      const calendarId = updated.googleCalendarId || 'primary';
      await google.moveEvent(connection, calendarId, updated.googleEventId, updated.startTime, updated.endTime).catch(() => {});
      const oldBuffers = parseJson(updated.googleBufferIdsJson, []);
      if (oldBuffers.length || connection.includeBuffers) {
        await google.deleteEventsQuiet(connection, calendarId, oldBuffers);
        const ids = connection.includeBuffers
          ? await google.createBufferEvents(connection, { booking: updated, eventType }).catch(() => [])
          : [];
        saved = await prisma.booking.update({ where: { id: updated.id }, data: { googleBufferIdsJson: JSON.stringify(ids) } });
      }
    }
  }

  return saved;
}

// by: 'host' | 'invitee'. skipGoogle: la cancelación vino DE Google (el
// evento ya no existe allá).
async function cancelBooking(requestedBooking, { by, reason, skipGoogle = false }) {
  return changeBooking(requestedBooking.hostId, 'canceled', async () => {
    const booking = await loadUpcoming(requestedBooking.id);
    if (skipGoogle && (booking.googleEventId !== requestedBooking.googleEventId ||
                       booking.googleCalendarId !== requestedBooking.googleCalendarId)) {
      throw new HttpError(409, 'La reserva ya cambió de evento de calendario');
    }
    const { eventType, host } = booking;
    const updated = await prisma.$transaction(async (tx) => {
      const canceled = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELED',
          canceledBy: by,
          cancelReason: String(reason || '').trim().slice(0, 1000) || null,
          canceledAt: new Date(),
        },
      });
      if (eventType.kind === 'one_off' && !eventType.isActive) {
        await tx.eventType.updateMany({
          where: { id: eventType.id, bookings: { none: { status: 'CONFIRMED' } } },
          data: { isActive: true },
        });
      }
      return canceled;
    });
    await detachFromGoogle(booking, { eventAlreadyDeleted: skipGoogle });
    return { booking: updated, eventType, host };
  });
}

module.exports = { HttpError, createBooking, rescheduleBooking, cancelBooking, manageUrl, withHostLock };
