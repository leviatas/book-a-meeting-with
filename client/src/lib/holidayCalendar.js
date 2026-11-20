import { DateTime } from 'luxon';

function escapeText(value) {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, '\\$&');
}

// iCalendar limita cada línea física a 75 octetos, incluidos los espacios de continuación.
function foldLine(line) {
  const encoder = new TextEncoder();
  let bytes = 0;
  let result = '';
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}

export function buildHolidayCalendar(holidays) {
  const stamp = DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Book a Meeting//Feriados argentinos//ES'];
  for (const { date, name } of holidays) {
    const day = DateTime.fromISO(date, { zone: 'utc' });
    lines.push(
      'BEGIN:VEVENT',
      `UID:feriado-ar-${date}@bookameeting`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day.toFormat('yyyyMMdd')}`,
      `DTEND;VALUE=DATE:${day.plus({ days: 1 }).toFormat('yyyyMMdd')}`,
      `SUMMARY:${escapeText(name)}`,
      'DESCRIPTION:Fuente de los datos: ArgentinaDatos (https://argentinadatos.com)',
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }
  return [...lines, 'END:VCALENDAR', ''].map(foldLine).join('\r\n');
}

export function downloadHolidayCalendar(holidays) {
  const file = new Blob([buildHolidayCalendar(holidays)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `feriados-argentina-${holidays[0].date.slice(0, 4)}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
