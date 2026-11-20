const test = require('node:test');
const assert = require('node:assert/strict');
const { getArgentinaHolidays } = require('../src/lib/argentinaHolidays');

test('ordena los feriados y combina las observancias de una misma fecha', async (t) => {
  const carnaval = { fecha: '2024-02-12', nombre: 'Carnaval', tipo: 'inamovible' };
  const items = [
    carnaval, { ...carnaval },
    { ...carnaval, nombre: 'Otro motivo', tipo: 'otro' },
    { fecha: '2024-01-01', nombre: ' Año Nuevo ', tipo: 'inamovible' },
  ];
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json(items));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const [holidays] = await Promise.all([getArgentinaHolidays(2024), getArgentinaHolidays(2024)]);
  assert.deepEqual(holidays, [
    { date: '2024-01-01', name: 'Año Nuevo', type: 'inamovible' },
    { date: '2024-02-12', name: 'Carnaval / Otro motivo', type: 'inamovible / otro' },
  ]);
  now += 3 * 60 * 60 * 1000 - 1;
  await getArgentinaHolidays(2024);
  assert.equal(request.mock.callCount(), 1);
  now += 1;
  await getArgentinaHolidays(2024);
  assert.equal(request.mock.callCount(), 2);
});

test('distingue un año sin datos de un error y permite reintentar', async (t) => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  response = new Response(null, { status: 503 });
  await assert.rejects(getArgentinaHolidays(2023), /503/);
  for (const fecha of ['2023-02-30', '2022-12-25']) {
    response = Response.json([{ fecha, tipo: 'inamovible', nombre: 'Navidad' }]);
    await assert.rejects(getArgentinaHolidays(2023), /Feriado inválido/);
  }
  response = new Response(null, { status: 404 });
  assert.deepEqual(await getArgentinaHolidays(2023), []);
});
