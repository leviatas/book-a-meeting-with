import { DateTime } from 'luxon';
import { LOCALE, capitalize } from '../lib/time';

const WEEKDAYS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

// month: DateTime al inicio del mes (en la zona del invitado).
// available: Set de "YYYY-MM-DD" con al menos un turno.
export default function MonthCalendar({ month, available, selected, onSelect, onPrev, onNext, canPrev, loading }) {
  const first = month.startOf('month');
  const offset = first.weekday - 1; // lunes primero
  const days = first.daysInMonth;
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(first.set({ day: d }));

  const today = DateTime.now().setZone(month.zone).toISODate();

  return (
    <div className="month-cal">
      <div className="month-cal-head">
        <button type="button" className="icon-button round" onClick={onPrev} disabled={!canPrev} aria-label="Mes anterior">
          ‹
        </button>
        <strong>{capitalize(month.setLocale(LOCALE).toFormat('LLLL yyyy'))}</strong>
        <button type="button" className="icon-button round" onClick={onNext} aria-label="Mes siguiente">
          ›
        </button>
      </div>
      <div className={`month-grid${loading ? ' is-loading' : ''}`}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="month-weekday">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const key = d.toISODate();
          const isAvailable = available.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`month-day${isAvailable ? ' available' : ''}${selected === key ? ' selected' : ''}${key === today ? ' today' : ''}`}
              aria-label={d.setLocale(LOCALE).toLocaleString(DateTime.DATE_FULL)}
              aria-pressed={selected === key}
              disabled={loading || !isAvailable}
              onClick={() => onSelect(key)}
            >
              {d.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
