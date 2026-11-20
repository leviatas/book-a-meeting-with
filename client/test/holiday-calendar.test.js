import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHolidayCalendar } from '../src/lib/holidayCalendar.js';

test('exporta cada fecha civil como un día ocupado y conserva nombres y acentos', () => {
  const longName = 'Día de la Soberanía '.repeat(5);
  const calendar = buildHolidayCalendar([
    { date: '2026-11-23', name: longName + 'A, B; C\\D\nE' },
    { date: '2026-12-31', name: 'Fin de año' },
  ]);
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = calendar.replace(/\r\n /g, '');
  assert.equal(unfolded.match(/BEGIN:VEVENT/g).length, 2);
  assert.equal(unfolded.match(/TRANSP:OPAQUE/g).length, 2);
  assert.match(unfolded, /DTSTART;VALUE=DATE:20261123\r\nDTEND;VALUE=DATE:20261124/);
  assert.match(unfolded, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.ok(unfolded.includes(`SUMMARY:${longName}A\\, B\\; C\\\\D\\nE\r\n`));
  assert.ok(unfolded.endsWith('END:VCALENDAR\r\n'));
});
