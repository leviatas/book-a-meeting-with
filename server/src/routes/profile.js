const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { RESERVED, isValidSlug } = require('../lib/users');
const { isValidZone } = require('../lib/availability');

const router = express.Router();

// Perfil público de la persona (username de la URL, zona horaria, saludo). Es
// global, no por empresa.
router.use(requireAuth);

router.put('/', async (req, res, next) => {
  try {
    const data = {};
    if (req.body.username !== undefined) {
      const username = String(req.body.username || '').trim().toLowerCase();
      if (!isValidSlug(username) || RESERVED.has(username)) {
        return res.status(400).json({ error: 'Ese usuario no es válido (letras, números y guiones)' });
      }
      const taken = await prisma.user.findFirst({ where: { username, NOT: { id: req.user.id } } });
      if (taken) return res.status(409).json({ error: 'Ese usuario ya está tomado' });
      data.username = username;
    }
    if (req.body.timezone !== undefined) {
      if (!isValidZone(req.body.timezone)) return res.status(400).json({ error: 'Zona horaria inválida' });
      data.timezone = req.body.timezone;
    }
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
      data.name = name;
    }
    if (req.body.welcomeMessage !== undefined) {
      data.welcomeMessage = String(req.body.welcomeMessage || '').trim().slice(0, 1000) || null;
    }
    // Topes globales de reuniones (entre todos los tipos de evento).
    for (const key of ['limitDay', 'limitWeek', 'limitMonth']) {
      if (req.body[key] === undefined) continue;
      const raw = req.body[key];
      if (raw === null || raw === '') {
        data[key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 1000) return res.status(400).json({ error: 'Ingresá un número entero de 1 a 1000' });
      data[key] = n;
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isSuperAdmin: user.isSuperAdmin,
        username: user.username,
        timezone: user.timezone,
        welcomeMessage: user.welcomeMessage,
        limitDay: user.limitDay,
        limitWeek: user.limitWeek,
        limitMonth: user.limitMonth,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
