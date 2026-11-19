const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { loadMembershipsForUser } = require('../lib/memberships');

const router = express.Router();

// Sin auth: lista de empresas para elegir a cuál pedir acceso al entrar por
// primera vez (pantalla de "sin empresa todavía", ver AccountStatus.jsx).
router.get('/public', async (req, res) => {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json({ companies });
});

router.use(requireAuth);

// Pedir acceso a una empresa. Queda PENDING hasta que un admin de esa empresa
// lo apruebe — salvo que sea el superadmin de la instancia, que entra directo:
// si la empresa todavía no tiene ningún admin, esperar sería un deadlock.
router.post('/:id/join', async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });

    const existing = await prisma.membership.findUnique({
      where: { userId_companyId: { userId: req.user.id, companyId } },
    });
    if (existing) return res.status(409).json({ error: 'Ya pediste acceso a esa empresa' });

    await prisma.membership.create({
      data: {
        userId: req.user.id,
        companyId,
        role: req.user.isSuperAdmin ? 'ADMIN' : 'DIRECTOR',
        status: req.user.isSuperAdmin ? 'APPROVED' : 'PENDING',
      },
    });

    res.status(201).json({ memberships: await loadMembershipsForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireSuperAdmin, async (req, res) => {
  const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } });
  res.json({ companies });
});

// Crear empresas es lo único que habilita el flag global isSuperAdmin.
router.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'El nombre de la empresa es obligatorio' });

    const company = await prisma.company.create({ data: { name } });
    // El que la crea queda adentro como admin: si no, la empresa nace sin
    // nadie que pueda aprobar a nadie.
    await prisma.membership.create({
      data: { userId: req.user.id, companyId: company.id, role: 'ADMIN', status: 'APPROVED' },
    });

    res.status(201).json({ company, memberships: await loadMembershipsForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
