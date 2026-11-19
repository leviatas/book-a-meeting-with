const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');

// Mails transaccionales (confirmación, reprogramación, cancelación). Opcional:
// sin SMTP_HOST no se manda nada y la app funciona igual — si el host tiene
// Google Calendar conectado, Google ya le manda la invitación al invitado.
let transporter = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatWhen(date, zone) {
  return DateTime.fromJSDate(date).setZone(zone).setLocale('es').toFormat("cccc d 'de' LLLL yyyy, HH:mm '('ZZZZ')'");
}

function icsDate(date) {
  return DateTime.fromJSDate(date).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

function icsEscape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildIcs({ booking, eventType, host, method }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Book a Meeting//ES',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${booking.uid}@bookameeting`,
    `SEQUENCE:${booking.rescheduleCount + (method === 'CANCEL' ? 1 : 0)}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(booking.startTime)}`,
    `DTEND:${icsDate(booking.endTime)}`,
    `SUMMARY:${icsEscape(`${eventType.title}: ${booking.inviteeName} y ${host.name}`)}`,
    `ORGANIZER;CN=${icsEscape(host.name)}:mailto:${host.email}`,
    `ATTENDEE;CN=${icsEscape(booking.inviteeName)};RSVP=TRUE:mailto:${booking.inviteeEmail}`,
    booking.location || booking.meetLink ? `LOCATION:${icsEscape(booking.meetLink || booking.location)}` : null,
    method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

const SUBJECTS = {
  created: (t) => `Confirmado: ${t}`,
  rescheduled: (t) => `Reprogramado: ${t}`,
  canceled: (t) => `Cancelado: ${t}`,
};

function body({ kind, booking, eventType, host, manageUrl, zone, forHost }) {
  const who = forHost ? booking.inviteeName : host.name;
  const lines = [
    `<p><strong>${escapeHtml(eventType.title)}</strong> con ${escapeHtml(who)}</p>`,
    `<p>${escapeHtml(formatWhen(booking.startTime, zone))} · ${eventType.durationMinutes} min</p>`,
  ];
  if (kind !== 'canceled' && (booking.meetLink || booking.location)) {
    lines.push(`<p>Dónde: ${escapeHtml(booking.meetLink || booking.location)}</p>`);
  }
  if (kind === 'canceled' && booking.cancelReason) {
    lines.push(`<p>Motivo: ${escapeHtml(booking.cancelReason)}</p>`);
  }
  const guests = guestsOf(booking);
  if (forHost && guests) lines.push(`<p>Invitados adicionales: ${guests.map(escapeHtml).join(', ')}</p>`);
  if (forHost) {
    lines.push(`<p>Invitado: ${escapeHtml(booking.inviteeName)} &lt;${escapeHtml(booking.inviteeEmail)}&gt;</p>`);
  } else if (kind !== 'canceled') {
    lines.push(`<p><a href="${escapeHtml(manageUrl)}">Reprogramar o cancelar</a></p>`);
  }
  return lines.join('\n');
}

// kind: 'created' | 'rescheduled' | 'canceled'. Nunca tira: un SMTP caído no
// puede deshacer una reserva ya guardada.
async function notifyBooking(kind, { booking, eventType, host, manageUrl, hostZone }) {
  const transport = getTransport();
  if (!transport) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = SUBJECTS[kind](eventType.title);
  const ics = buildIcs({ booking, eventType, host, method: kind === 'canceled' ? 'CANCEL' : 'REQUEST' });
  const icalEvent = { method: kind === 'canceled' ? 'CANCEL' : 'REQUEST', content: ics };

  const messages = [
    {
      to: booking.inviteeEmail,
      cc: guestsOf(booking),
      subject,
      html: body({ kind, booking, eventType, host, manageUrl, zone: booking.inviteeTimezone, forHost: false }),
      // Si el evento ya está en Google Calendar, Google manda su propia
      // invitación: adjuntar el .ics también le duplicaría el evento.
      ...(booking.googleEventId ? {} : { icalEvent }),
    },
    {
      to: host.email,
      subject,
      html: body({ kind, booking, eventType, host, manageUrl, zone: hostZone, forHost: true }),
    },
  ];

  for (const msg of messages) {
    try {
      await transport.sendMail({ from, ...msg });
    } catch (err) {
      console.error(`No se pudo mandar el mail (${kind}) a ${msg.to}:`, err.message);
    }
  }
}

function guestsOf(booking) {
  try {
    const list = JSON.parse(booking.guestsJson || '[]');
    return Array.isArray(list) && list.length ? list : undefined;
  } catch (e) {
    return undefined;
  }
}

function isEnabled() {
  return Boolean(process.env.SMTP_HOST);
}

// Devuelve true si se mandó (el job marca el recordatorio como enviado sólo
// entonces, así un SMTP caído se reintenta en la próxima vuelta). El asunto usa
// el tiempo que falta de verdad, no el configurado: el job puede correr unos
// minutos tarde.
async function sendReminder({ booking, eventType, host, manageUrl }) {
  const transport = getTransport();
  if (!transport) return false;
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: booking.inviteeEmail,
      cc: guestsOf(booking),
      subject: `Recordatorio: ${eventType.title} ${DateTime.fromJSDate(booking.startTime).setLocale('es').toRelative()}`,
      html: body({ kind: 'reminder', booking, eventType, host, manageUrl, zone: booking.inviteeTimezone, forHost: false }),
    });
    return true;
  } catch (err) {
    console.error(`No se pudo mandar el recordatorio a ${booking.inviteeEmail}:`, err.message);
    return false;
  }
}

async function sendFollowUp({ booking, eventType, host }) {
  const transport = getTransport();
  if (!transport) return false;
  const message = eventType.followUpMessage || `¡Gracias por la reunión! Si querés volver a agendar, respondé este mail.`;
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      replyTo: host.email,
      to: booking.inviteeEmail,
      subject: `${eventType.title} con ${host.name}`,
      html: `<p>Hola ${escapeHtml(booking.inviteeName)},</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p><p>${escapeHtml(host.name)}</p>`,
    });
    return true;
  } catch (err) {
    console.error(`No se pudo mandar el seguimiento a ${booking.inviteeEmail}:`, err.message);
    return false;
  }
}

module.exports = { notifyBooking, sendReminder, sendFollowUp, isEnabled };
