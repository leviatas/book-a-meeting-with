const { DateTime } = require('luxon');

const CACHE_MS = 3 * 60 * 60 * 1000;
const cache = new Map();

async function fetchHolidays(year) {
  const response = await fetch(`https://api.argentinadatos.com/v1/feriados/${year}`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`ArgentinaDatos respondió con HTTP ${response.status}`);
  const items = await response.json();
  if (!Array.isArray(items)) throw new Error('Listado de feriados inválido');

  const days = new Map();
  for (const item of items) {
    const date = item?.fecha;
    const name = typeof item?.nombre === 'string' && item.nombre.trim();
    const type = typeof item?.tipo === 'string' && item.tipo.trim();
    if (!name || !type || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !date.startsWith(`${year}-`) || !DateTime.fromISO(date, { zone: 'utc' }).isValid) {
      throw new Error('Feriado inválido en la respuesta de ArgentinaDatos');
    }
    if (!days.has(date)) days.set(date, { date, names: new Set(), types: new Set() });
    const day = days.get(date);
    day.names.add(name);
    day.types.add(type);
  }
  return [...days.values()]
    .map(({ date, names, types }) => ({ date, name: [...names].join(' / '), type: [...types].join(' / ') }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getArgentinaHolidays(year) {
  const cached = cache.get(year);
  if (cached && Date.now() < cached.expiresAt) return cached.request;
  const request = fetchHolidays(year).catch((error) => {
    cache.delete(year);
    throw error;
  });
  cache.set(year, { request, expiresAt: Date.now() + CACHE_MS });
  return request;
}

module.exports = { getArgentinaHolidays };
