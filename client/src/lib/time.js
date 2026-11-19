import { DateTime } from 'luxon';

// Todas las fechas de la UI pasan por acá, con zona explícita. No usar
// toLocaleString/getHours de Date: leen la zona del navegador, y en el panel
// importa la del host y en la página pública la que elija el invitado.

export const LOCALE = 'es';

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

let zonesCache = null;
export function allZones() {
  if (zonesCache) return zonesCache;
  try {
    zonesCache = Intl.supportedValuesOf('timeZone');
  } catch (e) {
    zonesCache = ['UTC', 'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'America/Bogota', 'America/Santiago', 'America/New_York', 'Europe/Madrid'];
  }
  if (!zonesCache.includes('UTC')) zonesCache = ['UTC', ...zonesCache];
  return zonesCache;
}

export function zoneLabel(zone) {
  const now = DateTime.now().setZone(zone);
  return `${zone.replace(/_/g, ' ')} (${now.toFormat('HH:mm')}, ${now.toFormat('ZZ')})`;
}

export function fmtTime(iso, zone, hour12 = false) {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).setLocale(LOCALE).toFormat(hour12 ? 'h:mm a' : 'HH:mm');
}

export function fmtDay(iso, zone) {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).setLocale(LOCALE).toFormat("cccc d 'de' LLLL yyyy");
}

export function fmtRange(startIso, endIso, zone) {
  return `${fmtTime(startIso, zone)} – ${fmtTime(endIso, zone)}`;
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export const LOCATION_LABELS = {
  google_meet: 'Google Meet',
  phone: 'Llamada telefónica',
  in_person: 'Presencial',
  custom: 'Link personalizado',
  none: 'A definir',
};

export function durationLabel(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
