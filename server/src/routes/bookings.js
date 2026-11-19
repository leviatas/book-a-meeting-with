const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireCompany, requireApproved, requireWriter } = require('../middleware/auth');
const { serializeBooking } = require('../lib/serialize');
const { cancelBooking, HttpError } = require('../lib/bookings');

const router = express.Router();

router.use(requireAuth, requireCompany, requireApproved);

const SCOPES = ['upcoming', 'past', 'canceled'];

// Reservas de la empresa activa. Cada persona ve las suyas; un ADMIN puede
// pedir ?all=1 para ver las de todo el equipo.
router.get('/', async (req, res) => {
  const scope = SCOPES.includes(req.query.scope) ? req.query.scope : 'upcoming';
  const all = req.query.all === '1' && req.membership.role === 'ADMIN';
  const now = new Date();

  const where = {
    companyId: req.company.id,
    ...(all ? {} : { hostId: req.user.id }),
    ...(scope === 'canceled'
      ? { status: 'CANCELED' }
      : { status: 'CONFIRMED', ...(scope === 'upcoming' ? { endTime: { gte: now } } : { endTime: { lt: now } }) }),
  };

  const rows = await prisma.booking.findMany({
    where,
    include: { eventType: true, host: true },
    orderBy: { startTime: scope === 'upcoming' ? 'asc' : 'desc' },
    take: 200,
  });
  res.json({ bookings: rows.map(serializeBooking) });
});

router.post('/:id/cancel', requireWriter, async (req, res, next) => {
  try {
    const booking = await prisma.booking.findFirst({
      where: {
        id: Number(req.params.id),
        companyId: req.company.id,
        ...(req.membership.role === 'ADMIN' ? {} : { hostId: req.user.id }),
      },
    });
    if (!booking) return res.status(404).json({ error: 'No encontrado' });
    const updated = await cancelBooking(booking, { by: 'host', reason: req.body.reason });
    res.json({ booking: serializeBooking(updated) });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
