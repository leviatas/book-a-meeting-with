const express = require('express');
const { DateTime } = require('luxon');
const prisma = require('../lib/prisma');
const { requireAuth, requireCompany, requireApproved, requireWriter } = require('../middleware/auth');
const { serializeEventType } = require('../lib/serialize');
const { slugify, isValidSlug, ensureDefaultSchedule } = require('../lib/users');

const router = express.Router();

// Tipos de evento del usuario logueado en la empresa activa. Cada persona
// administra los suyos: se filtra SIEMPRE por companyId y userId.
router.use(requireAuth, requireCompany, requireApproved);

const LOCATION_TYPES = ['google_meet', 'phone', 'in_person', 'custom', 'none'];
const QUESTION_TYPES = ['text', 'textarea', 'phone', 'radio', 'checkbox', 'select'];
const OPTION_TYPES = ['radio', 'checkbox', 'select'];
const KINDS = ['one_on_one', 'group', 'one_off'];

function intIn(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function optionalInt(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  return intIn(value, min, max, null);
}

// Arma el `data` de Prisma desde el body. `existing` = PUT (sólo lo que vino;
// lo demás se completa del registro actual donde hace falta).
function parseBody(body, existing) {
  const partial = Boolean(existing);
  const data = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('title')) {
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) throw new Error('El nombre del evento es obligatorio');
    data.title = title;
  }
  if (has('slug') || !partial) {
    const slug = slugify(body.slug || body.title);
    if (!isValidSlug(slug)) throw new Error('El link sólo puede tener letras, números y guiones');
    data.slug = slug;
  }
  if (has('description')) data.description = String(body.description || '').trim().slice(0, 5000) || null;
  if (has('color')) data.color = /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#2563eb';
  if (has('durationMinutes') || !partial) data.durationMinutes = intIn(body.durationMinutes, 5, 720, 30);
  if (has('locationType')) {
    if (!LOCATION_TYPES.includes(body.locationType)) throw new Error('Tipo de ubicación inválido');
    data.locationType = body.locationType;
  }
  if (has('locationValue')) data.locationValue = String(body.locationValue || '').trim().slice(0, 500) || null;
  if (has('bufferBefore')) data.bufferBefore = intIn(body.bufferBefore, 0, 240, 0);
  if (has('bufferAfter')) data.bufferAfter = intIn(body.bufferAfter, 0, 240, 0);
  if (has('minNoticeMinutes')) data.minNoticeMinutes = intIn(body.minNoticeMinutes, 0, 60 * 24 * 30, 240);
  if (has('maxDaysAhead')) data.maxDaysAhead = intIn(body.maxDaysAhead, 1, 365, 60);
  if (has('slotInterval')) data.slotInterval = optionalInt(body.slotInterval, 5, 720);
  if (has('dailyLimit')) data.dailyLimit = optionalInt(body.dailyLimit, 1, 100);
  if (has('weeklyLimit')) data.weeklyLimit = optionalInt(body.weeklyLimit, 1, 500);
  if (has('monthlyLimit')) data.monthlyLimit = optionalInt(body.monthlyLimit, 1, 2000);
  if (has('isActive')) data.isActive = Boolean(body.isActive);
  if (has('isSecret')) data.isSecret = Boolean(body.isSecret);
  if (has('lockTimezone')) data.lockTimezone = Boolean(body.lockTimezone);
  if (has('allowGuests')) data.allowGuests = Boolean(body.allowGuests);

  // Tipo de reunión. En un PUT parcial lo que no vino sale del registro actual.
  if (has('kind') && !KINDS.includes(body.kind)) throw new Error('Tipo de reunión inválido');
  const kind = has('kind') ? body.kind : existing ? existing.kind : 'one_on_one';
  data.kind = kind;
  if (kind === 'group') {
    data.seats = has('seats') ? optionalInt(body.seats, 2, 500) : existing && existing.seats;
    if (!data.seats) throw new Error('Indicá cuántos invitados entran por turno (2 o más)');
  } else {
    data.seats = null;
  }
  if (has('oneOffSlots')) {
    if (!Array.isArray(body.oneOffSlots)) throw new Error('Horarios inválidos');
    const slots = body.oneOffSlots.slice(0, 50).map((iso) => {
      const t = DateTime.fromISO(String(iso), { zone: 'utc' });
      if (!t.isValid) throw new Error('Hay un horario inválido');
      return t.set({ second: 0, millisecond: 0 }).toISO({ suppressMilliseconds: true });
    });
    data.oneOffSlotsJson = JSON.stringify([...new Set(slots)].sort());
  }
  if (kind === 'one_off') {
    const slots = JSON.parse(data.oneOffSlotsJson || (existing && existing.oneOffSlotsJson) || '[]');
    if (slots.length === 0) throw new Error('Agregá al menos un horario para la reunión única');
    // Una reunión única no aparece en el perfil: se comparte su link.
    data.isSecret = true;
  }

  if (has('questions')) {
    if (!Array.isArray(body.questions)) throw new Error('Preguntas inválidas');
    const questions = body.questions.slice(0, 20).map((q, i) => {
      const label = String(q.label || '').trim().slice(0, 300);
      if (!label) throw new Error(`La pregunta ${i + 1} no tiene texto`);
      const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
      const withOptions = OPTION_TYPES.includes(type);
      const options = withOptions
        ? [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 200)).filter(Boolean))].slice(0, 30)
        : [];
      if (withOptions && options.length === 0) throw new Error(`La pregunta "${label}" necesita al menos una opción`);
      return {
        id: String(q.id || `q${Date.now().toString(36)}${i}`).slice(0, 40),
        label,
        type,
        required: Boolean(q.required),
        enabled: q.enabled !== false,
        options,
        allowOther: withOptions && type !== 'select' ? Boolean(q.allowOther) : false,
      };
    });
    data.questionsJson = JSON.stringify(questions);
  }

  if (has('redirectUrl')) {
    const url = String(body.redirectUrl || '').trim();
    if (url && !isHttpUrl(url)) throw new Error('La URL de redirección tiene que empezar con http:// o https://');
    data.redirectUrl = url ? url.slice(0, 1000) : null;
  }
  if (has('confirmationLinks')) {
    if (!Array.isArray(body.confirmationLinks)) throw new Error('Links inválidos');
    const links = body.confirmationLinks.slice(0, 5).map((l) => {
      const label = String(l.label || '').trim().slice(0, 80);
      const url = String(l.url || '').trim().slice(0, 1000);
      if (!label || !isHttpUrl(url)) throw new Error('Cada link necesita un texto y una URL http(s)');
      return { label, url };
    });
    data.confirmationLinksJson = JSON.stringify(links);
  }
  if (has('reminders')) {
    if (!Array.isArray(body.reminders)) throw new Error('Recordatorios inválidos');
    const list = [...new Set(body.reminders.map((m) => intIn(m, 5, 7 * 1440, null)).filter(Boolean))].slice(0, 3);
    data.remindersJson = JSON.stringify(list.sort((a, b) => b - a));
  }
  if (has('followUpMinutes')) data.followUpMinutes = optionalInt(body.followUpMinutes, 0, 7 * 1440);
  if (has('followUpMessage')) data.followUpMessage = String(body.followUpMessage || '').trim().slice(0, 3000) || null;
  return data;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// El horario elegido tiene que ser del mismo usuario y empresa.
async function resolveScheduleId(req, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const schedule = await prisma.schedule.findFirst({
    where: { id: Number(value), userId: req.user.id, companyId: req.company.id },
  });
  if (!schedule) throw new Error('Horario inválido');
  return schedule.id;
}

async function slugTaken(userId, slug, exceptId) {
  const found = await prisma.eventType.findFirst({
    where: { userId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  return Boolean(found);
}

router.get('/', async (req, res) => {
  const rows = await prisma.eventType.findMany({
    where: { companyId: req.company.id, userId: req.user.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ eventTypes: rows.map(serializeEventType), username: req.user.username });
});

router.get('/:id', async (req, res) => {
  const row = await prisma.eventType.findFirst({
    where: { id: Number(req.params.id), companyId: req.company.id, userId: req.user.id },
  });
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  res.json({ eventType: serializeEventType(row) });
});

router.post('/', requireWriter, async (req, res, next) => {
  try {
    let data;
    let scheduleId;
    try {
      data = parseBody(req.body, null);
      scheduleId = await resolveScheduleId(req, req.body.scheduleId);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (await slugTaken(req.user.id, data.slug)) {
      return res.status(409).json({ error: 'Ya tenés un evento con ese link' });
    }
    // Sin horario no hay turnos: se asegura uno antes del primer evento.
    await ensureDefaultSchedule(req.user, req.company.id);

    const row = await prisma.eventType.create({
      data: {
        ...data,
        scheduleId: scheduleId ?? null,
        userId: req.user.id,
        companyId: req.company.id,
      },
    });
    res.status(201).json({ eventType: serializeEventType(row) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireWriter, async (req, res, next) => {
  try {
    const existing = await prisma.eventType.findFirst({
      where: { id: Number(req.params.id), companyId: req.company.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    let data;
    let scheduleId;
    try {
      data = parseBody(req.body, existing);
      scheduleId = await resolveScheduleId(req, req.body.scheduleId);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (data.slug && (await slugTaken(req.user.id, data.slug, existing.id))) {
      return res.status(409).json({ error: 'Ya tenés un evento con ese link' });
    }

    const row = await prisma.eventType.update({
      where: { id: existing.id },
      data: { ...data, ...(scheduleId !== undefined ? { scheduleId } : {}) },
    });
    res.json({ eventType: serializeEventType(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/duplicate', requireWriter, async (req, res, next) => {
  try {
    const existing = await prisma.eventType.findFirst({
      where: { id: Number(req.params.id), companyId: req.company.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    let slug = `${existing.slug}-copia`;
    for (let i = 2; await slugTaken(req.user.id, slug); i++) slug = `${existing.slug}-copia-${i}`;

    const { id, createdAt, ...rest } = existing;
    const row = await prisma.eventType.create({ data: { ...rest, slug, title: `${existing.title} (copia)` } });
    res.status(201).json({ eventType: serializeEventType(row) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireWriter, async (req, res, next) => {
  try {
    const existing = await prisma.eventType.findFirst({
      where: { id: Number(req.params.id), companyId: req.company.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    // Con reservas no se borra (se perdería el historial): se desactiva.
    const count = await prisma.booking.count({ where: { eventTypeId: existing.id } });
    if (count > 0) {
      await prisma.eventType.update({ where: { id: existing.id }, data: { isActive: false } });
      return res.json({ archived: true });
    }
    await prisma.eventType.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
