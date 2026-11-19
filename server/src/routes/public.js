const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { computeSlots, hostZoneFor } = require('../lib/availability');
const { createBooking, rescheduleBooking, cancelBooking, HttpError } = require('../lib/bookings');
const { serializePublicEventType, serializeBooking, parseJson } = require('../lib/serialize');

const router = express.Router();

// Rutas SIN auth: la página pública de reserva y la de gestión del invitado.
// La "credencial" del invitado es el uid de la reserva (16 bytes al azar).
// Nunca devolver acá emails del host, reglas internas ni datos de otras
// reservas.

const readLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
});

router.use(readLimiter);

function publicHost(user) {
  return { name: user.name, username: user.username, avatarUrl: user.avatarUrl, welcomeMessage: user.welcomeMessage };
}

async function findHost(username) {
  return prisma.user.findUnique({ where: { username: String(username).toLowerCase() } });
}

// rescheduleUid: una reunión única queda inactiva con su reserva, pero el
// invitado de ESA reserva tiene que poder ver los horarios para moverla.
async function findEventType(username, slug, rescheduleUid) {
  const host = await findHost(username);
  if (!host) return null;
  const eventType = await prisma.eventType.findFirst({
    where: { userId: host.id, slug: String(slug).toLowerCase() },
    include: { user: true, schedule: true },
  });
  if (!eventType) return null;
  if (eventType.isActive) return { host, eventType };
  if (eventType.kind !== 'one_off' || !rescheduleUid) return null;
  const booking = await prisma.booking.findUnique({ where: { uid: String(rescheduleUid) } });
  if (!booking || booking.eventTypeId !== eventType.id || booking.status !== 'CONFIRMED') return null;
  return { host, eventType: { ...eventType, isActive: true } };
}

// Link de un solo uso: resuelve el tipo de evento aunque sea secreto. Uno ya
// usado da 410 para que la página explique qué pasó en vez de un 404 genérico.
async function findByLink(token) {
  const link = await prisma.singleUseLink.findUnique({
    where: { token: String(token) },
    include: { eventType: { include: { user: true, schedule: true } } },
  });
  if (!link) return { error: 404 };
  if (link.usedAt) return { error: 410 };
  if (!link.eventType.isActive) return { error: 404 };
  return { host: link.eventType.user, eventType: link.eventType, link };
}

async function publicEventType(eventType) {
  return serializePublicEventType(eventType, {
    timezone: eventType.lockTimezone ? await hostZoneFor(eventType) : null,
  });
}

async function slotsFor(eventType, query) {
  // Al reprogramar, el horario actual de la reserva no cuenta como ocupado.
  let excludeBookingId;
  let requiredSeats = 1;
  if (query.reschedule) {
    const b = await prisma.booking.findUnique({ where: { uid: String(query.reschedule) } });
    if (b && b.status === 'CONFIRMED' && b.eventTypeId === eventType.id) {
      excludeBookingId = b.id;
      requiredSeats += parseJson(b.guestsJson, []).length;
    }
  }
  const { slots, seatsLeft } = await computeSlots(eventType, {
    fromDate: String(query.from || ''),
    toDate: String(query.to || ''),
    timezone: String(query.timezone || 'UTC'),
    excludeBookingId,
    requiredSeats,
  });
  return { slots, seatsLeft };
}

const LINK_ERRORS = {
  404: 'Este link no existe o el evento ya no está disponible',
  410: 'Este link ya se usó para agendar una reunión',
};

function sendError(res, next, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  return next(err);
}

router.get('/u/:username', async (req, res) => {
  const host = await findHost(req.params.username);
  if (!host) return res.status(404).json({ error: 'No encontramos esa página' });
  const eventTypes = await prisma.eventType.findMany({
    where: { userId: host.id, isActive: true, isSecret: false },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ host: publicHost(host), eventTypes: eventTypes.map((e) => serializePublicEventType(e)) });
});

router.get('/u/:username/:slug', async (req, res) => {
  const found = await findEventType(req.params.username, req.params.slug, req.query.reschedule);
  if (!found) return res.status(404).json({ error: 'Este evento no existe o no está disponible' });
  res.json({ host: publicHost(found.host), eventType: await publicEventType(found.eventType) });
});

router.get('/u/:username/:slug/slots', async (req, res, next) => {
  try {
    const found = await findEventType(req.params.username, req.params.slug, req.query.reschedule);
    if (!found) return res.status(404).json({ error: 'Este evento no existe o no está disponible' });

    res.json(await slotsFor(found.eventType, req.query));
  } catch (err) {
    next(err);
  }
});

router.post('/u/:username/:slug/book', writeLimiter, async (req, res, next) => {
  try {
    const found = await findEventType(req.params.username, req.params.slug);
    if (!found) return res.status(404).json({ error: 'Este evento no existe o no está disponible' });
    const booking = await createBooking(found.eventType, req.body || {});
    res.status(201).json({ uid: booking.uid, redirectUrl: found.eventType.redirectUrl });
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/d/:token', async (req, res) => {
  const found = await findByLink(req.params.token);
  if (found.error) return res.status(found.error).json({ error: LINK_ERRORS[found.error] });
  res.json({ host: publicHost(found.host), eventType: await publicEventType(found.eventType) });
});

router.get('/d/:token/slots', async (req, res, next) => {
  try {
    const found = await findByLink(req.params.token);
    if (found.error) return res.status(found.error).json({ error: LINK_ERRORS[found.error] });
    res.json(await slotsFor(found.eventType, { ...req.query, reschedule: undefined }));
  } catch (err) {
    next(err);
  }
});

router.post('/d/:token/book', writeLimiter, async (req, res, next) => {
  try {
    const found = await findByLink(req.params.token);
    if (found.error) return res.status(found.error).json({ error: LINK_ERRORS[found.error] });
    // createBooking vuelve a chequear el link adentro del candado: dos envíos
    // simultáneos con el mismo link no pueden reservar los dos.
    const booking = await createBooking(found.eventType, req.body || {}, { linkToken: req.params.token });
    res.status(201).json({ uid: booking.uid, redirectUrl: found.eventType.redirectUrl });
  } catch (err) {
    sendError(res, next, err);
  }
});

async function findBooking(uid) {
  return prisma.booking.findUnique({
    where: { uid: String(uid) },
    include: { eventType: true, host: true },
  });
}

router.get('/bookings/:uid', async (req, res) => {
  const booking = await findBooking(req.params.uid);
  if (!booking) return res.status(404).json({ error: 'No encontramos esa reserva' });
  const data = serializeBooking(booking);
  // El invitado no necesita el email del host: lo contacta por la invitación.
  delete data.host.email;
  res.json({ booking: data });
});

router.post('/bookings/:uid/cancel', writeLimiter, async (req, res, next) => {
  try {
    const booking = await findBooking(req.params.uid);
    if (!booking) return res.status(404).json({ error: 'No encontramos esa reserva' });
    await cancelBooking(booking, { by: 'invitee', reason: req.body && req.body.reason });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, next, err);
  }
});

router.post('/bookings/:uid/reschedule', writeLimiter, async (req, res, next) => {
  try {
    const booking = await findBooking(req.params.uid);
    if (!booking) return res.status(404).json({ error: 'No encontramos esa reserva' });
    await rescheduleBooking(booking, req.body && req.body.start);
    res.json({ ok: true, uid: booking.uid });
  } catch (err) {
    sendError(res, next, err);
  }
});

module.exports = router;
