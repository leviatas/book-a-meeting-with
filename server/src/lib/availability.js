const { DateTime } = require('luxon');
const prisma = require('./prisma');
const google = require('./google');
const { serializeSchedule, parseJson } = require('./serialize');

// Cálculo de turnos libres. Todo en luxon con zonas explícitas: NUNCA usar
// getHours()/setDate() de Date acá, leen la TZ del proceso y el host, el
// invitado y el contenedor pueden estar en tres husos distintos.
//
//   candidatos: horario semanal / excepciones del día (o, en una reunión
//               única, la lista fija oneOffSlots)
//   - aviso mínimo / ventana máxima hacia adelante
//   - reservas existentes del host (de CUALQUIER tipo de evento y empresa:
//     la persona es una sola), con sus buffers
//   - ocupado en Google Calendar (freebusy de los calendarios elegidos)
//   - topes por día/semana/mes del tipo de evento y globales del host
//   = turnos, agrupados por fecha en la zona del INVITADO.
//
// Grupales: un turno donde ya hay invitados de ESE tipo sigue ofreciéndose
// hasta llenar `seats`, y sumarse a él no cuenta para los topes (es la misma
// reunión). Por eso esas reservas no lo bloquean ni lo bloquea su evento en
// Google (que freebusy devuelve como ocupado).

const MAX_RANGE_DAYS = 62;

function parseHHMM(value) {
  const [h, m] = String(value).split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

function isValidZone(zone) {
  return Boolean(zone) && DateTime.local().setZone(zone).isValid;
}

// Intervalos de pared de un día concreto del host, ya convertidos a instantes.
function dayIntervals(schedule, day) {
  const dateStr = day.toISODate();
  const override = schedule.overrides.find((o) => o.date === dateStr);
  // luxon: weekday 1 = lunes … 7 = domingo. El schedule usa 0 = domingo.
  const ranges = override ? override.intervals : schedule.weekly[String(day.weekday % 7)] || [];
  return ranges
    .map(([from, to]) => {
      const start = day.set({ ...parseHHMM(from), second: 0, millisecond: 0 });
      const end = to === '24:00' ? day.plus({ days: 1 }) : day.set({ ...parseHHMM(to), second: 0, millisecond: 0 });
      return { start, end };
    })
    .filter((r) => r.end > r.start);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

async function loadSchedule(eventType) {
  let row = eventType.schedule || null;
  if (!row && eventType.scheduleId) {
    row = await prisma.schedule.findUnique({ where: { id: eventType.scheduleId } });
  }
  if (!row) {
    row = await prisma.schedule.findFirst({
      where: { userId: eventType.userId, companyId: eventType.companyId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
  }
  return serializeSchedule(row);
}

// Zona "de pared" del host para este evento: la de su horario.
async function hostZoneFor(eventType) {
  const schedule = await loadSchedule(eventType);
  const zone = schedule && schedule.timezone;
  return isValidZone(zone) ? zone : 'UTC';
}

// Clave de "reunión": un grupal con N invitados es UNA reunión para los topes.
function meetingKey(b) {
  return `${b.eventTypeId}:${b.startTime.getTime()}`;
}

// Cuenta reuniones (no reservas) por día/semana/mes, global y por tipo.
function periodKeys(time, zone) {
  const local = time.setZone(zone);
  return [`d:${local.toISODate()}`, `w:${local.startOf('week').toISODate()}`, `m:${local.toFormat('yyyy-LL')}`];
}

function buildCounters(bookings, scheduleZone, profileZone) {
  const seen = new Set();
  const counters = { global: {}, byType: {} };
  for (const b of bookings) {
    const key = meetingKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    const t = DateTime.fromJSDate(b.startTime);
    const typeMap = (counters.byType[b.eventTypeId] = counters.byType[b.eventTypeId] || {});
    for (const p of periodKeys(t, profileZone)) {
      counters.global[p] = (counters.global[p] || 0) + 1;
    }
    for (const p of periodKeys(t, scheduleZone)) {
      typeMap[p] = (typeMap[p] || 0) + 1;
    }
  }
  return counters;
}

function limitReached(counts, limits, time, zone) {
  if (!limits.some(Boolean)) return false;
  return periodKeys(time, zone).some((key, i) => limits[i] && (counts[key] || 0) >= limits[i]);
}

async function busyFromGoogle(connection, from, to, ownBookings) {
  if (!connection || !google.isEnabled()) return { busy: [], calendarOk: true };
  try {
    const gBusy = await google.freeBusy(connection, from.toJSDate(), to.toJSDate(), ownBookings);
    return {
      busy: gBusy.map((b) => ({ start: DateTime.fromJSDate(b.start), end: DateTime.fromJSDate(b.end) })),
      calendarOk: true,
    };
  } catch (err) {
    // Falla abierta: si Google no responde se ofrecen igual los turnos (con
    // las reservas propias sí descontadas) y el error queda en
    // GoogleConnection.lastError, que el host ve en Integraciones. Cerrar la
    // agenda entera por un token vencido sería peor.
    return { busy: [], calendarOk: false };
  }
}

// Instantes candidatos (antes de restar ocupado), en orden.
function candidateStarts(eventType, schedule, hostZone, windowStart, windowEnd) {
  const duration = eventType.durationMinutes;

  if (eventType.kind === 'one_off') {
    // Las propuestas manuales pueden quedar fuera del horario semanal y cruzar
    // medianoche. Un feriado bloquea el día civil completo en la zona del horario.
    const holidays = (schedule?.overrides || [])
      .filter((override) => override.holidayName && override.intervals.length === 0)
      .map(({ date }) => {
        const start = DateTime.fromISO(date, { zone: hostZone });
        return { start, end: start.plus({ days: 1 }).startOf('day') };
      });
    return parseJson(eventType.oneOffSlotsJson, [])
      .map((iso) => DateTime.fromISO(iso, { zone: 'utc' }))
      .filter((start) => {
        if (!start.isValid) return false;
        const end = start.plus({ minutes: duration });
        return !holidays.some((holiday) => overlaps(start, end, holiday.start, holiday.end));
      })
      .sort((a, b) => a - b);
  }

  const step = eventType.slotInterval || duration;
  const out = [];
  let day = windowStart.setZone(hostZone).startOf('day');
  const lastDay = windowEnd.setZone(hostZone).startOf('day');
  while (day <= lastDay) {
    for (const range of dayIntervals(schedule, day)) {
      for (let t = range.start; t.plus({ minutes: duration }) <= range.end; t = t.plus({ minutes: step })) {
        out.push(t);
      }
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

// fromDate / toDate: "YYYY-MM-DD" en la zona del invitado, inclusive.
async function computeSlots(eventType, { fromDate, toDate, timezone, excludeBookingId, requiredSeats = 1, now = DateTime.utc() }) {
  const empty = { slots: {}, seatsLeft: {}, calendarOk: true };
  if (!eventType.isActive) return empty;
  if (eventType.kind === 'one_off') {
    // Un host puede haber reactivado el tipo desde el panel. Una reserva en
    // cualquier fecha consume todas las alternativas que ofreció.
    const taken = await prisma.booking.findFirst({
      where: { eventTypeId: eventType.id, status: 'CONFIRMED', ...(excludeBookingId ? { NOT: { id: excludeBookingId } } : {}) },
      select: { id: true },
    });
    if (taken) return empty;
  }
  const inviteeZone = isValidZone(timezone) ? timezone : 'UTC';
  const schedule = await loadSchedule(eventType);
  if (!schedule && eventType.kind !== 'one_off') return empty;

  const host = eventType.user || (await prisma.user.findUnique({ where: { id: eventType.userId } }));
  const profileZone = isValidZone(host.timezone) ? host.timezone : 'UTC';
  const hostZone = schedule && isValidZone(schedule.timezone) ? schedule.timezone : profileZone;

  let rangeStart = DateTime.fromISO(fromDate, { zone: inviteeZone }).startOf('day');
  let rangeEnd = DateTime.fromISO(toDate, { zone: inviteeZone }).endOf('day');
  if (!rangeStart.isValid || !rangeEnd.isValid || rangeEnd < rangeStart) return empty;
  if (rangeEnd.diff(rangeStart, 'days').days > MAX_RANGE_DAYS) {
    rangeEnd = rangeStart.plus({ days: MAX_RANGE_DAYS }).endOf('day');
  }

  const earliest = now.plus({ minutes: eventType.minNoticeMinutes });
  const latest =
    eventType.kind === 'one_off'
      ? rangeEnd
      : now.setZone(hostZone).plus({ days: eventType.maxDaysAhead }).endOf('day');
  const windowStart = DateTime.max(rangeStart, earliest);
  const windowEnd = DateTime.min(rangeEnd, latest);
  if (windowEnd <= windowStart) return empty;

  // Reservas confirmadas del host: con margen de un día para buffers, y desde
  // el inicio del mes/semana para poder contar los topes.
  const countZones = [hostZone, profileZone];
  const countFrom = DateTime.min(...countZones.flatMap((zone) => ['month', 'week'].map((p) => windowStart.setZone(zone).startOf(p))));
  const countTo = DateTime.max(...countZones.flatMap((zone) => ['month', 'week'].map((p) => windowEnd.setZone(zone).endOf(p))));
  const confirmed = await prisma.booking.findMany({
    where: {
      hostId: eventType.userId,
      status: 'CONFIRMED',
      startTime: { lt: countTo.plus({ days: 1 }).toJSDate() },
      endTime: { gt: countFrom.minus({ days: 1 }).toJSDate() },
    },
    include: { eventType: { select: { bufferBefore: true, bufferAfter: true } } },
  });

  const bookings = confirmed.filter((b) => b.id !== excludeBookingId);
  const counters = buildCounters(bookings, hostZone, profileZone);
  const typeCounts = counters.byType[eventType.id] || {};
  const typeLimits = [eventType.dailyLimit, eventType.weeklyLimit, eventType.monthlyLimit];
  const personalLimits = [host.limitDay, host.limitWeek, host.limitMonth];

  // Ocupación de grupales de ESTE tipo por instante de inicio.
  const groupTaken = {};
  if (eventType.kind === 'group') {
    for (const b of bookings) {
      if (b.eventTypeId !== eventType.id) continue;
      const start = b.startTime.getTime();
      groupTaken[start] = (groupTaken[start] || 0) + 1 + parseJson(b.guestsJson, []).length;
    }
  }

  const ownBusy = bookings.map((b) => ({
    start: DateTime.fromJSDate(b.startTime).minus({ minutes: b.eventType.bufferBefore }),
    end: DateTime.fromJSDate(b.endTime).plus({ minutes: b.eventType.bufferAfter }),
    groupKey: eventType.kind === 'group' && b.eventTypeId === eventType.id ? b.startTime.getTime() : null,
  }));

  const connection = await prisma.googleConnection.findUnique({ where: { userId: eventType.userId } });
  const from = windowStart.minus({ minutes: eventType.bufferBefore });
  const to = windowEnd.plus({ minutes: eventType.durationMinutes + eventType.bufferAfter });
  const ownGoogleBookings = confirmed.filter((b) => b.googleEventId && (
    b.id === excludeBookingId ||
    (eventType.kind === 'group' && b.eventTypeId === eventType.id && b.startTime < to && b.endTime > from)
  )).map((b) => ({ ...b, ignore: b.id === excludeBookingId }));
  const { busy: gBusy, calendarOk } = await busyFromGoogle(connection, from, to, ownGoogleBookings);

  const duration = eventType.durationMinutes;
  const slots = {};
  const seatsLeft = {};

  for (const t of candidateStarts(eventType, schedule, hostZone, windowStart, windowEnd)) {
    if (t < windowStart || t > windowEnd) continue;
    const end = t.plus({ minutes: duration });
    const padStart = t.minus({ minutes: eventType.bufferBefore });
    const padEnd = end.plus({ minutes: eventType.bufferAfter });
    const ms = t.toMillis();
    const joined = groupTaken[ms] || 0;

    if (eventType.kind === 'group' && joined + requiredSeats > eventType.seats) continue;

    // Sumarse a un grupal ya existente no es una reunión nueva: no cuenta para
    // los topes y su propio evento no lo bloquea.
    const isJoin = eventType.kind === 'group' && joined > 0;
    if (!isJoin && (limitReached(typeCounts, typeLimits, t, hostZone) || limitReached(counters.global, personalLimits, t, profileZone))) continue;

    const blockedByOwn = ownBusy.some((b) => !(isJoin && b.groupKey === ms) && overlaps(padStart, padEnd, b.start, b.end));
    if (blockedByOwn) continue;
    const blockedByGoogle = gBusy.some((b) => overlaps(padStart, padEnd, b.start, b.end));
    if (blockedByGoogle) continue;

    const iso = t.toUTC().toISO({ suppressMilliseconds: true });
    const key = t.setZone(inviteeZone).toISODate();
    (slots[key] = slots[key] || []).push(iso);
    if (eventType.kind === 'group') seatsLeft[iso] = (eventType.seats || 1) - joined;
  }

  for (const key of Object.keys(slots)) slots[key].sort();
  return { slots, seatsLeft, calendarOk };
}

// ¿Este instante exacto es un turno ofrecible? Se usa al reservar/reprogramar:
// el cliente manda la hora que eligió y el server la revalida contra todo.
async function isSlotAvailable(eventType, startIso, { excludeBookingId, requiredSeats } = {}) {
  const start = DateTime.fromISO(startIso, { zone: 'utc' });
  if (!start.isValid) return false;
  // Rango de ±1 día en UTC para no depender de la zona del invitado.
  const { slots } = await computeSlots(eventType, {
    fromDate: start.minus({ days: 1 }).toISODate(),
    toDate: start.plus({ days: 1 }).toISODate(),
    timezone: 'UTC',
    excludeBookingId,
    requiredSeats,
  });
  const wanted = start.toISO({ suppressMilliseconds: true });
  return Object.values(slots).some((list) => list.includes(wanted));
}

module.exports = { computeSlots, isSlotAvailable, isValidZone, dayIntervals, hostZoneFor, loadSchedule };
