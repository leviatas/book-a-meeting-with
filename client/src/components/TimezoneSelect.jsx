import { useMemo } from 'react';
import { allZones, zoneLabel } from '../lib/time';

export default function TimezoneSelect({ value, onChange, id, className }) {
  const zones = useMemo(() => {
    const list = allZones();
    return value && !list.includes(value) ? [value, ...list] : list;
  }, [value]);

  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {zoneLabel(z)}
        </option>
      ))}
    </select>
  );
}
