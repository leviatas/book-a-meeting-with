const express = require('express');
const { DateTime } = require('luxon');
const prisma = require('../lib/prisma');
const { requireAuth, requireCompany, requireApproved, requireWriter } = require('../middleware/auth');
const { serializeSchedule, DEFAULT_WEEKLY } = require('../lib/serialize');
const { ensureDefaultSchedule } = require('../lib/users');
const { isValidZone } = require('../lib/availability');
const { getArgentinaHolidays } = require('../lib/argentinaHolidays');

const router = express.Router();

router.use(requireAuth, requireCompany, requireApproved);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// [["09:00","12:00"],["13:00","17:00"]] validado, ordenado y sin solapes.
function parseIntervals(list, label) {
  if (!Array.isArray(list)) throw new Error(`Horarios inválidos (${label})`);
  const parsed = list.map((pair) => {
    if (!Array.isArray(pair) || !HHMM.test(pair[0]) || !HHMM.test(pair[1])) {
      throw new Error(`Hora inválida (${label})`);
    }
    if (pair[1] <= pair[0]) throw new Error(`La hora de fin tiene que ser posterior a la de inicio (${label})`);
    return [pair[0], pair[1]];
  });
  parsed.sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i][0] < parsed[i - 1][1]) throw new Error(`Hay horarios superpuestos (${label})`);
  }
  return parsed;
}

const DAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function parseBody(body, partial) {
  const data = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) throw new Error('El nombre del horario es obligatorio');
    data.name = name;
  }
  if (!partial || body.timezone !== undefined) {
    if (!isValidZone(body.timezone)) throw new Error('Zona horaria inválida');
    data.timezone = body.timezone;
  }
  if (!partial || body.weekly !== undefined) {
    const weekly = body.weekly || DEFAULT_WEEKLY;
    const clean = {};
    for (let d = 0; d < 7; d++) clean[d] = parseIntervals(weekly[d] || weekly[String(d)] || [], DAY_LABELS[d]);
    data.weeklyJson = JSON.stringify(clean);
  }
  if (body.overrides !== undefined) {
    if (!Array.isArray(body.overrides)) throw new Error('Excepciones inválidas');
    if (body.overrides.length > 500) throw new Error('El horario admite hasta 500 excepciones');
    const seen = new Set();
    const overrides = body.overrides.map((o) => {
      if (!DATE.test(o.date)) throw new Error('Fecha de excepción inválida');
      if (seen.has(o.date)) throw new Error(`La fecha ${o.date} está repetida`);
      seen.add(o.date);
      const intervals = parseIntervals(o.intervals || [], o.date);
      const override = { date: o.date, intervals };
      if (!intervals.length && typeof o.holidayName === 'string' && o.holidayName.trim()) {
        override.holidayName = o.holidayName.trim().slice(0, 200);
      }
      return override;
    });
    overrides.sort((a, b) => a.date.localeCompare(b.date));
    data.overridesJson = JSON.stringify(overrides);
  }
  return data;
}

function scoped(req, id) {
  return prisma.schedule.findFirst({ where: { id: Number(id), companyId: req.company.id, userId: req.user.id } });
}

router.get('/', async (req, res) => {
  await ensureDefaultSchedule(req.user, req.company.id);
  const rows = await prisma.schedule.findMany({
    where: { companyId: req.company.id, userId: req.user.id },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
  });
  res.json({ schedules: rows.map(serializeSchedule) });
});

router.get('/holidays/argentina/:year', async (req, res) => {
  const year = Number(req.params.year);
  const maxYear = DateTime.now().setZone('America/Argentina/Buenos_Aires').year + 1;
  if (!/^\d{4}$/.test(req.params.year) || year < 2016 || year > maxYear) {
    return res.status(400).json({ error: `Elegí un año entre 2016 y ${maxYear}.` });
  }
  try {
    const holidays = await getArgentinaHolidays(year);
    if (!holidays.length) {
      return res.status(404).json({ error: `ArgentinaDatos todavía no tiene feriados publicados para ${year}.` });
    }
    res.json({ holidays });
  } catch {
    res.status(502).json({ error: 'No se pudieron consultar los feriados en ArgentinaDatos. Volvé a intentar.' });
  }
});

router.post('/', requireWriter, async (req, res, next) => {
  try {
    let data;
    try {
      data = parseBody({ timezone: req.user.timezone, ...req.body }, false);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const row = await prisma.schedule.create({
      data: { ...data, userId: req.user.id, companyId: req.company.id, isDefault: false },
    });
    res.status(201).json({ schedule: serializeSchedule(row) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireWriter, async (req, res, next) => {
  try {
    const existing = await scoped(req, req.params.id);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    let data;
    try {
      data = parseBody(req.body, true);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const row = await prisma.schedule.update({ where: { id: existing.id }, data });
    res.json({ schedule: serializeSchedule(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/default', requireWriter, async (req, res, next) => {
  try {
    const existing = await scoped(req, req.params.id);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    await prisma.$transaction([
      prisma.schedule.updateMany({
        where: { companyId: req.company.id, userId: req.user.id },
        data: { isDefault: false },
      }),
      prisma.schedule.update({ where: { id: existing.id }, data: { isDefault: true } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWriter, async (req, res, next) => {
  try {
    const existing = await scoped(req, req.params.id);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    if (existing.isDefault) {
      return res.status(409).json({ error: 'No se puede borrar el horario predeterminado. Marcá otro primero.' });
    }
    // Los eventos que lo usaban quedan con scheduleId null (onDelete: SetNull)
    // y pasan a usar el predeterminado.
    await prisma.schedule.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
