const prisma = require('./prisma');
const { DEFAULT_WEEKLY } = require('./serialize');

// Rutas del cliente que no pueden usarse como username: /u/<username> no
// choca hoy con nada, pero reservar estos deja la puerta abierta a mover la
// página pública a /<username> como Calendly sin migrar datos.
const RESERVED = new Set([
  'api', 'u', 'admin', 'reserva', 'reservas', 'eventos', 'disponibilidad',
  'integraciones', 'perfil', 'login', 'logout', 'assets', 'static',
]);

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function isValidSlug(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(value);
}

async function uniqueUsername(base, exceptUserId) {
  let root = slugify(base) || 'usuario';
  if (RESERVED.has(root)) root = `${root}-1`;
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await prisma.user.findFirst({
      where: { username: candidate, ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}) },
    });
    if (!taken) return candidate;
  }
  throw new Error('No se pudo generar un username');
}

// Se llama en cada login / me: un usuario viejo sin username lo recibe solo.
async function ensureUsername(user) {
  if (user.username) return user;
  const username = await uniqueUsername(user.email.split('@')[0], user.id);
  return prisma.user.update({ where: { id: user.id }, data: { username } });
}

// Cada persona necesita al menos un horario por empresa para que sus tipos de
// evento tengan disponibilidad. Se crea perezosamente la primera vez que se
// lo pide.
async function ensureDefaultSchedule(user, companyId) {
  const query = {
    where: { userId: user.id, companyId },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
  };
  const existing = await prisma.schedule.findFirst(query);
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const schedule = await tx.schedule.findFirst(query);
    if (schedule) return schedule;
    return tx.schedule.create({
      data: {
        userId: user.id,
        companyId,
        name: 'Horario laboral',
        timezone: user.timezone,
        weeklyJson: JSON.stringify(DEFAULT_WEEKLY),
        isDefault: true,
      },
    });
  });
}

module.exports = { RESERVED, slugify, isValidSlug, uniqueUsername, ensureUsername, ensureDefaultSchedule };
