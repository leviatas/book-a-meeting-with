const express = require('express');
const prisma = require('../lib/prisma');
const {
  requireAuth,
  requireCompany,
  requireApproved,
  requireWriter,
} = require('../middleware/auth');

const router = express.Router();

// Router de datos de ejemplo: copiá este archivo como molde para cada entidad
// nueva y borralo cuando tengas las reales.
//
// Los tres middleware de arriba van a nivel de router (todos leen); el
// requireWriter va INLINE en cada ruta que escribe, para que un READER siga
// pudiendo ver.
router.use(requireAuth, requireCompany, requireApproved);

router.get('/', async (req, res) => {
  const items = await prisma.item.findMany({
    where: { companyId: req.company.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items });
});

router.get('/:id', async (req, res) => {
  // findFirst y no findUnique: un id de otra empresa tiene que dar 404 en vez
  // de filtrar la fila.
  const item = await prisma.item.findFirst({
    where: { id: Number(req.params.id), companyId: req.company.id },
  });
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  res.json({ item });
});

router.post('/', requireWriter, async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'El título es obligatorio' });

    const item = await prisma.item.create({
      data: {
        title,
        notes: req.body.notes ? String(req.body.notes) : null,
        // El companyId sale SIEMPRE del middleware, nunca del body: si no,
        // cualquiera podría escribir en otra empresa mandando otro id.
        companyId: req.company.id,
      },
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireWriter, async (req, res, next) => {
  try {
    const existing = await prisma.item.findFirst({
      where: { id: Number(req.params.id), companyId: req.company.id },
    });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    const item = await prisma.item.update({
      where: { id: existing.id },
      data: {
        ...(req.body.title !== undefined ? { title: String(req.body.title).trim() } : {}),
        ...(req.body.notes !== undefined ? { notes: req.body.notes || null } : {}),
      },
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWriter, async (req, res, next) => {
  try {
    const existing = await prisma.item.findFirst({
      where: { id: Number(req.params.id), companyId: req.company.id },
    });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    await prisma.item.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
