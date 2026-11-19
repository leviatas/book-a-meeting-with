const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireCompany, requireApproved, requireWriter } = require('../middleware/auth');
const { randomUid } = require('../lib/crypto');
const google = require('../lib/google');

const router = express.Router();

// Links de un solo uso (Calendly: "Single-use links"). Cuelgan de un tipo de
// evento: el alcance se chequea a través de él (companyId + userId), el link no
// lleva companyId propio.
router.use(requireAuth, requireCompany, requireApproved);

function serialize(link) {
  return {
    id: link.id,
    url: `${google.publicOrigin()}/d/${link.token}`,
    createdAt: link.createdAt,
    usedAt: link.usedAt,
    eventType: link.eventType ? { id: link.eventType.id, title: link.eventType.title, color: link.eventType.color } : undefined,
    booking: link.booking
      ? { uid: link.booking.uid, inviteeName: link.booking.inviteeName, startTime: link.booking.startTime, status: link.booking.status }
      : null,
  };
}

const ownEventTypes = (req) => ({ companyId: req.company.id, userId: req.user.id });

router.get('/', async (req, res) => {
  const links = await prisma.singleUseLink.findMany({
    where: { eventType: ownEventTypes(req) },
    include: { eventType: true, booking: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ links: links.map(serialize) });
});

router.post('/', requireWriter, async (req, res, next) => {
  try {
    const eventType = await prisma.eventType.findFirst({
      where: { id: Number(req.body.eventTypeId), ...ownEventTypes(req) },
    });
    if (!eventType) return res.status(404).json({ error: 'Tipo de evento no encontrado' });
    if (!eventType.isActive) return res.status(409).json({ error: 'Ese evento está desactivado' });
    const link = await prisma.singleUseLink.create({
      data: { token: randomUid(), eventTypeId: eventType.id },
      include: { eventType: true, booking: true },
    });
    res.status(201).json({ link: serialize(link) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWriter, async (req, res, next) => {
  try {
    const link = await prisma.singleUseLink.findFirst({
      where: { id: Number(req.params.id), eventType: ownEventTypes(req) },
    });
    if (!link) return res.status(404).json({ error: 'No encontrado' });
    await prisma.singleUseLink.delete({ where: { id: link.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
