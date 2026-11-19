const test = require('node:test');
const assert = require('node:assert/strict');
const { OAuth2Client } = require('google-auth-library');
const { freeBusy } = require('../src/lib/google');

test('un cupo grupal respeta otras reuniones simultáneas en Google', async (t) => {
  const start = new Date('2030-01-15T14:00:00Z');
  const end = new Date('2030-01-15T15:00:00Z');
  const connection = { googleEmail: 'host@example.test', conflictCalendarIdsJson: '["primary","equipo"]' };
  const own = [{ googleCalendarId: 'primary', googleEventId: 'taller', startTime: start, endTime: end }];
  const interval = { start: start.toISOString(), end: end.toISOString() };
  const group = { id: 'taller', start: { dateTime: interval.start }, end: { dateTime: interval.end } };
  let primaryEvents = [group];
  let teamBusy = [];
  t.mock.method(OAuth2Client.prototype, 'request', async ({ url }) => {
    if (url.endsWith('/freeBusy')) {
      return { data: { calendars: { 'host@example.test': { busy: [interval] }, equipo: { busy: teamBusy } } } };
    }
    assert.ok(url.endsWith('/host%40example.test/events'));
    return { data: { items: primaryEvents } };
  });
  assert.deepEqual(await freeBusy(connection, start, end, own), []);
  primaryEvents = [group, { ...group, id: 'otro' }];
  assert.deepEqual(await freeBusy(connection, start, end, own), [{ start, end }]);
  primaryEvents = [group];
  teamBusy = [interval];
  assert.deepEqual(await freeBusy(connection, start, end, own), [{ start, end }]);
});
