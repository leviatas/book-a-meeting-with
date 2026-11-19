const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const express = require('express');
const { DateTime } = require('luxon');

test('agenda personal con una base SQLite temporal', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bookameeting-test-'));
  const database = path.join(dir, 'test.db');
  await writeFile(database, '');
  process.env.DATABASE_URL = 'file:' + database.replace(/\\/g, '/');
  process.env.GOOGLE_CLIENT_SECRET = '';
  process.env.SMTP_HOST = '';
  const prisma = require('../src/lib/prisma');
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const serverDir = path.join(__dirname, '..');
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: serverDir, stdio: 'pipe',
  });

  const host = await prisma.user.create({
    data: { email: 'host@example.test', googleId: 'host', name: 'Anfitrión', username: 'host' },
  });
  const company = await prisma.company.create({ data: { name: 'Agenda personal' } });
  const base = { companyId: company.id, userId: host.id, minNoticeMinutes: 0, locationType: 'none' };
  const monday = DateTime.utc().plus({ weeks: 2 }).startOf('week').set({ hour: 12 });
  const day = monday.toISODate();
  const starts = [monday, monday.plus({ hours: 1 })].map((time) => time.toISO({ suppressMilliseconds: true }));
  await prisma.eventType.create({
    data: { ...base, title: 'Reunión única', slug: 'unica', kind: 'one_off', isSecret: true, oneOffSlotsJson: JSON.stringify(starts) },
  });
  const recurring = await prisma.eventType.create({ data: { ...base, title: 'Semanal', slug: 'semanal' } });
  await prisma.schedule.create({
    data: { userId: host.id, companyId: company.id, timezone: 'UTC', name: 'Laboral', isDefault: true, weeklyJson: '{"1":[["09:00","17:00"]]}' },
  });
  await prisma.singleUseLink.create({ data: { token: 'enlace-de-prueba', eventTypeId: recurring.id } });

  const app = express();
  app.use(express.json());
  app.use('/api/public', require('../src/routes/public'));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port + '/api/public';
  async function request(pathname, body) {
    const response = await fetch(origin + pathname, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const invitee = { name: 'Invitada', email: 'guest@example.test', timezone: 'UTC' };
  const query = '?from=' + day + '&to=' + day + '&timezone=UTC';

  await t.test('dos ingresos simultáneos reciben un solo espacio y horario', async () => {
    const { ensurePersonalWorkspace } = require('../src/lib/memberships');
    const { ensureDefaultSchedule } = require('../src/lib/users');
    await Promise.all([ensurePersonalWorkspace(host), ensurePersonalWorkspace(host)]);
    const memberships = await prisma.membership.findMany({ where: { userId: host.id } });
    assert.equal(memberships.length, 1);
    const companyId = memberships[0].companyId;
    const schedules = await Promise.all([ensureDefaultSchedule(host, companyId), ensureDefaultSchedule(host, companyId)]);
    assert.equal(schedules[0].id, schedules[1].id);
  });

  await t.test('dos horarios de una reunión única compiten por la misma reserva', async () => {
    const url = '/u/host/unica';
    const offered = await request(url + '/slots' + query);
    assert.deepEqual(offered.data.slots[day], starts);
    const results = await Promise.all(starts.map((start) => request(url + '/book', { ...invitee, start })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 404]);
    const winner = results.findIndex((r) => r.status === 201);
    const uid = results[winner].data.uid;
    const management = '/bookings/' + uid;
    assert.equal((await request(url)).status, 404);
    const remaining = await request(url + '/slots' + query + '&reschedule=' + uid);
    assert.deepEqual(remaining.data.slots[day], starts);

    const otherSlot = starts[1 - winner];
    assert.equal((await request(management + '/reschedule', { start: otherSlot })).status, 200);
    const moved = await request(management);
    assert.equal(moved.data.booking.startTime, new Date(otherSlot).toISOString());
    assert.equal(moved.data.booking.rescheduleCount, 1);

    const cancels = await Promise.all([request(management + '/cancel', {}), request(management + '/cancel', {})]);
    assert.deepEqual(cancels.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await request(management)).data.booking.status, 'CANCELED');
    assert.equal((await request(management + '/reschedule', { start: starts[0] })).status, 409);
    assert.deepEqual((await request(url + '/slots' + query)).data.slots[day], starts);
  });

  await t.test('un link se consume una sola vez y sigue usado después de cancelar', async () => {
    const url = '/d/enlace-de-prueba';
    const offered = await request(url + '/slots' + query);
    const choices = offered.data.slots[day].slice(0, 2);
    const results = await Promise.all(choices.map((start) => request(url + '/book', { ...invitee, start })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 410]);
    assert.equal(await prisma.booking.count({ where: { eventTypeId: recurring.id } }), 1);
    const uid = results.find((r) => r.status === 201).data.uid;
    assert.equal((await request('/bookings/' + uid + '/cancel', {})).status, 200);
    assert.equal((await request(url)).status, 410);
    assert.deepEqual((await request('/u/host/semanal/slots' + query)).data.slots[day], offered.data.slots[day]);
  });

  await t.test('el cupo del taller alcanza para todos los acompañantes al reservar y reprogramar', async () => {
    await prisma.eventType.create({ data: { ...base, kind: 'group', seats: 3, title: 'Taller', slug: 'taller' } });
    const url = '/u/host/taller';
    const [first, second] = (await request(url + '/slots' + query)).data.slots[day];
    const party = { ...invitee, guests: ['acompanante@example.test'] };
    const a = await request(url + '/book', { ...party, start: first });
    assert.equal(a.status, 201);
    assert.equal((await request(url + '/slots' + query)).data.seatsLeft[first], 1);
    assert.equal((await request(url + '/book', { ...party, start: first })).status, 409);
    const b = await request(url + '/book', { ...party, start: second });
    assert.equal(b.status, 201);
    const management = '/bookings/' + b.data.uid;
    const options = await request(url + '/slots' + query + '&reschedule=' + b.data.uid);
    assert.ok(!options.data.slots[day].includes(first));
    assert.equal((await request(management + '/reschedule', { start: first })).status, 409);
    await request('/bookings/' + a.data.uid + '/cancel', {});
    assert.equal((await request(management + '/reschedule', { start: first })).status, 200);
  });

  await t.test('el tope diario personal usa la misma zona para todos los horarios', async () => {
    await prisma.user.update({ where: { id: host.id }, data: { limitDay: 1, timezone: 'America/Argentina/Buenos_Aires' } });
    const midnight = monday.plus({ days: 1 }).startOf('day');
    const evening = midnight.minus({ hours: 1 }).toJSDate();
    const candidate = midnight.plus({ hours: 1 }).toISO({ suppressMilliseconds: true });
    const nextDay = midnight.plus({ hours: 4 }).toISO({ suppressMilliseconds: true });
    await prisma.eventType.create({ data: {
      ...base, kind: 'one_off', title: 'Otra zona', slug: 'otra-zona', oneOffSlotsJson: JSON.stringify([candidate, nextDay]),
    } });
    await prisma.booking.create({ data: {
      companyId: company.id, hostId: host.id, eventTypeId: recurring.id, uid: 'limite-personal',
      startTime: evening, endTime: new Date(+evening + 30 * 60000), inviteeName: 'Ana',
      inviteeEmail: 'ana@example.test', inviteeTimezone: 'UTC',
    } });
    const date = midnight.toISODate();
    const result = await request('/u/host/otra-zona/slots?from=' + date + '&to=' + date + '&timezone=UTC');
    assert.deepEqual(result.data.slots[date], [nextDay]);
  });

  await t.test('una reunión movida o cancelada desde Google actualiza la reserva y sus márgenes', async (t) => {
    const google = require('../src/lib/google');
    const { runGoogleSync } = require('../src/lib/jobs');
    await prisma.googleConnection.create({ data: {
      userId: host.id, googleEmail: host.email, refreshTokenEnc: 'local', includeBuffers: true, targetCalendarId: 'nuevo',
    } });
    const uid = 'sincronizacion';
    const future = monday.plus({ days: 3 });
    const newStart = future.plus({ hours: 1 }).toJSDate();
    const newEnd = future.plus({ minutes: 90 }).toJSDate();
    await prisma.booking.create({ data: {
      uid, companyId: company.id, hostId: host.id, eventTypeId: recurring.id, startTime: future.toJSDate(),
      endTime: future.plus({ minutes: 30 }).toJSDate(), inviteeName: 'Ana', inviteeEmail: 'ana@example.test', inviteeTimezone: 'UTC',
      googleCalendarId: 'original', googleEventId: 'evento', googleBufferIdsJson: '["margen-anterior"]',
    } });
    let event = { id: 'evento', start: { dateTime: newStart.toISOString() }, end: { dateTime: newEnd.toISOString() } };
    t.mock.method(google, 'isEnabled', () => true);
    t.mock.method(google, 'listChangedEvents', async () => [event]);
    const removed = t.mock.method(google, 'deleteEventsQuiet', async () => {});
    t.mock.method(google, 'createBufferEvents', async () => ['margen-nuevo']);
    await runGoogleSync();
    const moved = await prisma.booking.findUniqueOrThrow({ where: { uid } });
    assert.equal(+moved.startTime, +newStart);
    assert.equal(moved.rescheduleCount, 1);
    assert.deepEqual(removed.mock.calls[0].arguments.slice(1), ['original', ['margen-anterior']]);
    await runGoogleSync();
    assert.equal(removed.mock.callCount(), 1);
    event = { id: 'evento', status: 'cancelled' };
    await runGoogleSync();
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { uid } })).status, 'CANCELED');
    assert.deepEqual(removed.mock.calls[1].arguments.slice(1), ['original', ['margen-nuevo']]);
  });
});
