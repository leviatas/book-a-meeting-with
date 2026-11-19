const express = require('express');
const prisma = require('../lib/prisma');
const {
  requireAuth,
  requireCompany,
  requireApproved,
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

// Todo este router es administración de la empresa activa.
router.use(requireAuth, requireCompany, requireApproved, requireAdmin);

const ROLES = ['ADMIN', 'DIRECTOR', 'READER'];
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

function serialize(m) {
  return {
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
    status: m.status,
    createdAt: m.createdAt,
  };
}

// Miembros de la empresa activa. Con ?status=PENDING sale la bandeja de altas.
router.get('/members', async (req, res) => {
  const { status } = req.query;
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  const members = await prisma.membership.findMany({
    where: { companyId: req.company.id, ...(status ? { status } : {}) },
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ members: members.map(serialize) });
});

// Un solo endpoint para aprobar, rechazar y cambiar de rol: son la misma
// escritura sobre la misma fila, y separarlos multiplicaba el chequeo de que
// la membresía sea de ESTA empresa.
router.post('/members/:id', async (req, res, next) => {
  try {
    const { role, status } = req.body;
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // findFirst con companyId y no findUnique: un id de otra empresa tiene que
    // dar 404, no dejarse tocar.
    const membership = await prisma.membership.findFirst({
      where: { id: Number(req.params.id), companyId: req.company.id },
    });
    if (!membership) return res.status(404).json({ error: 'Miembro no encontrado' });

    if (membership.userId === req.user.id && (status === 'REJECTED' || role === 'READER')) {
      return res.status(400).json({ error: 'No podés sacarte a vos mismo el acceso' });
    }

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: { ...(role !== undefined ? { role } : {}), ...(status !== undefined ? { status } : {}) },
      include: { user: true },
    });
    res.json({ member: serialize(updated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
