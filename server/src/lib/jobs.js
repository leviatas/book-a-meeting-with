const { DateTime } = require('luxon');
const prisma = require('./prisma');
const google = require('./google');
const mailer = require('./mailer');
const { parseJson } = require('./serialize');
const { cancelBooking, manageUrl, withHostLock, HttpError } = require('./bookings');
const { hostZoneFor } = require('./availability');

// Tareas periódicas dentro del mismo proceso del server (no hay cola aparte):
//   - recordatorios por mail N minutos antes de la reunión     (cada minuto)
//   - mail de seguimiento N minutos después de que termina     (cada minuto)
//   - traer de Google los eventos movidos o borrados por el host (cada 5 min)
// Como el candado de reservas, asume UNA sola instancia del server: con
// réplicas cada una mandaría su copia de cada recordatorio.

const MINUTE = 60 * 1000;
// Si un aviso se pasó de su hora por más que esto (server caído, SMTP
// configurado recién), se da por mandado en vez de llegar tarde y fuera de
// contexto.
const STALE_MS = 6 * 60 * MINUTE;
const MAX_REMINDER_MINUTES = 7 * 1440;

async function runReminders(now = new Date()) {
  if (!mailer.isEnabled()) return;
  const bookings = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      startTime: { gt: now, lte: new Date(now.getTime() + MAX_REMINDER_MINUTES * MINUTE) },
      eventType: { remindersJson: { not: '[]' } },
    },
    include: { eventType: true, host: true },
  });

  for (const booking of bookings) {
    const reminders = parseJson(booking.eventType.remindersJson, []);
    const sent = parseJson(booking.remindersSentJson, []);
    let changed = false;
    for (const minutes of reminders) {
      if (sent.includes(minutes)) continue;
      const due = booking.startTime.getTime() - minutes * MINUTE;
      if (now.getTime() < due) continue;
      // Reservado (o reprogramado) cuando el aviso ya estaba vencido: el mail
      // de confirmación hace de recordatorio.
      const skip = booking.createdAt.getTime() > due || now.getTime() - due > STALE_MS;
      const ok =
        skip ||
        (await mailer.sendReminder({
          booking,
          eventType: booking.eventType,
          host: booking.host,
          manageUrl: manageUrl(booking.uid),
        }));
      if (ok) {
        sent.push(minutes);
        changed = true;
      }
    }
    if (changed) {
      await prisma.booking.update({ where: { id: booking.id }, data: { remindersSentJson: JSON.stringify(sent) } });
    }
  }
}

async function runFollowUps(now = new Date()) {
  if (!mailer.isEnabled()) return;
  const bookings = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      followUpSentAt: null,
      endTime: { lte: now, gt: new Date(now.getTime() - 8 * 1440 * MINUTE) },
      eventType: { followUpMinutes: { not: null } },
    },
    include: { eventType: true, host: true },
  });

  for (const booking of bookings) {
    const due = booking.endTime.getTime() + booking.eventType.followUpMinutes * MINUTE;
    if (now.getTime() < due) continue;
    const ok =
      now.getTime() - due > STALE_MS ||
      (await mailer.sendFollowUp({ booking, eventType: booking.eventType, host: booking.host }));
    if (ok) await prisma.booking.update({ where: { id: booking.id }, data: { followUpSentAt: now } });
  }
}

// ---- Sincronización desde Google ------------------------------------------

function eventTimes(event) {
  if (!event.start || !event.start.dateTime || !event.end || !event.end.dateTime) return null;
  return { start: new Date(event.start.dateTime), end: new Date(event.end.dateTime) };
}

async function applyMove(booking, times, connection) {
  const updated = await withHostLock(booking.hostId, async () => {
    // La lectura de Google ocurre fuera del candado. Una reserva puede haber
    // cambiado de turno, de evento compartido o de estado durante la consulta.
    const current = await prisma.booking.findFirst({
      where: {
        id: booking.id, status: 'CONFIRMED', googleEventId: booking.googleEventId,
        googleCalendarId: booking.googleCalendarId, startTime: booking.startTime, endTime: booking.endTime,
      },
    });
    if (!current) return null;
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startTime: times.start,
        endTime: times.end,
        rescheduleCount: { increment: 1 },
        remindersSentJson: '[]',
      },
      include: { eventType: true, host: true },
    });
    // Los márgenes viejos quedan en el horario anterior: se rehacen.
    const calendarId = updated.googleCalendarId || 'primary';
    const oldBuffers = parseJson(updated.googleBufferIdsJson, []);
    if (oldBuffers.length || (connection.includeBuffers && updated.eventType.kind !== 'group')) {
      await google.deleteEventsQuiet(connection, calendarId, oldBuffers);
      const ids = connection.includeBuffers && updated.eventType.kind !== 'group'
        ? await google.createBufferEvents(connection, { booking: updated, eventType: updated.eventType }).catch(() => [])
        : [];
      await prisma.booking.update({ where: { id: updated.id }, data: { googleBufferIdsJson: JSON.stringify(ids) } });
    }
    return updated;
  });
  if (updated) {
    await mailer.notifyBooking('rescheduled', {
      booking: updated,
      eventType: updated.eventType,
      host: updated.host,
      manageUrl: manageUrl(updated.uid),
      hostZone: await hostZoneFor(updated.eventType),
    });
  }
}

async function syncConnection(connection, now) {
  const upcoming = await prisma.booking.findMany({
    where: { hostId: connection.userId, status: 'CONFIRMED', startTime: { gt: now }, googleEventId: { not: null } },
  });
  if (upcoming.length === 0) {
    await prisma.googleConnection.update({ where: { id: connection.id }, data: { lastSyncAt: now } });
    return;
  }

  // Google rechaza updatedMin muy viejos con showDeleted: se acota a 20 días.
  const floor = new Date(now.getTime() - 20 * 1440 * MINUTE);
  const since = new Date(Math.max(+floor, +(connection.lastSyncAt || connection.createdAt)));

  const byEvent = new Map();
  for (const b of upcoming) {
    const key = `${b.googleCalendarId || 'primary'}|${b.googleEventId}`;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(b);
  }
  const calendars = [...new Set(upcoming.map((b) => b.googleCalendarId || 'primary'))];

  for (const calendarId of calendars) {
    const events = await google.listChangedEvents(connection, calendarId, since);
    for (const event of events) {
      const bookings = byEvent.get(`${calendarId}|${event.id}`);
      if (!bookings) continue;

      if (event.status === 'cancelled') {
        for (const booking of bookings) {
          try {
            await cancelBooking(booking, { by: 'host', reason: 'Cancelada desde Google Calendar', skipGoogle: true });
          } catch (err) {
            if (!(err instanceof HttpError && [404, 409].includes(err.status))) throw err;
          }
        }
        continue;
      }

      const times = eventTimes(event);
      if (!times) continue;
      const moved = bookings.filter(
        (b) => b.startTime.getTime() !== times.start.getTime() || b.endTime.getTime() !== times.end.getTime(),
      );
      for (const booking of moved) await applyMove(booking, times, connection);
    }
  }
  await prisma.googleConnection.update({ where: { id: connection.id }, data: { lastSyncAt: now } });
}

async function runGoogleSync(now = new Date()) {
  if (!google.isEnabled()) return;
  const connections = await prisma.googleConnection.findMany({ where: { syncFromGoogle: true } });
  for (const connection of connections) {
    try {
      await syncConnection(connection, now);
    } catch (err) {
      // gRequest ya dejó el error en lastError; se reintenta en la próxima vuelta
      // desde el mismo lastSyncAt.
    }
  }
}

function every(ms, name, fn) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      console.error(`Tarea ${name}:`, err);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10 * 1000);
  return setInterval(tick, ms);
}

function startJobs() {
  every(MINUTE, 'recordatorios', async () => {
    await runReminders();
    await runFollowUps();
  });
  every(5 * MINUTE, 'sync Google', () => runGoogleSync());
}

module.exports = { startJobs, runReminders, runFollowUps, runGoogleSync };
