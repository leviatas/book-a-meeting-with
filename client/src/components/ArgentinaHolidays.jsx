import { useEffect, useId, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../api';
import { LOCALE } from '../lib/time';

const HOLIDAY_TYPES = {
  inamovible: 'Inamovible',
  trasladable: 'Trasladable',
  puente: 'Puente turístico',
};

function searchable(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(LOCALE).trim();
}

function HolidayResults({ token, year, timezone, overrides, canWrite, onApply, onExport, onApplied }) {
  const [holidays, setHolidays] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let active = true;
    api.schedules.argentinaHolidays(token, year)
      .then(({ holidays: list }) => { if (active) setHolidays(list); })
      .catch((err) => { if (active) setLoadError(err.message); });
    return () => { active = false; };
  }, [token, year, attempt]);

  if (loadError) {
    return (
      <>
        <p className="error-text" role="alert">{loadError}</p>
        <button type="button" onClick={() => { setLoadError(''); setAttempt(attempt + 1); }}>Reintentar</button>
      </>
    );
  }
  if (!holidays) return <p className="muted small" role="status">Cargando feriados…</p>;
  if (!holidays.length) return <p className="muted small" role="status">Todavía no hay feriados publicados para {year}.</p>;

  const today = DateTime.now().setZone(timezone).toISODate();
  const overridesByDate = new Map(overrides.map((entry) => [entry.date, entry]));
  const term = searchable(query);
  const results = [];
  const chosen = [];
  const toBlock = [];

  for (const holiday of holidays) {
    const { date, name, type } = holiday;
    const when = DateTime.fromISO(date, { zone: timezone }).setLocale(LOCALE);
    const label = when.toFormat("cccc d 'de' LLLL");
    const override = overridesByDate.get(date);
    const applied = Boolean(override?.holidayName && override.intervals.length === 0);
    const past = date < today;
    if (selected.has(date)) {
      chosen.push(holiday);
      if (!applied && !past) toBlock.push(holiday);
    }
    const terms = [name, label, date, when.toFormat('dd/MM/yyyy'), when.toFormat('d/M/yyyy')];
    if (!term || searchable(terms.join(' ')).includes(term)) {
      let status = '';
      if (applied) status = 'Feriado ya bloqueado';
      else if (past) status = 'Fecha pasada';
      else if (override) status = override.intervals.length ? 'Horario especial' : 'Excepción de día completo';
      const typeLabel = type.split(' / ').map((part) => HOLIDAY_TYPES[part] || part).join(' / ');
      results.push({ date, name, label, typeLabel, status });
    }
  }

  const allVisibleSelected = results.length > 0 && results.every(({ date }) => selected.has(date));

  function selectDates(dates, checked) {
    setSelected((current) => {
      const next = new Set(current);
      for (const date of dates) {
        if (checked) next.add(date);
        else next.delete(date);
      }
      return next;
    });
    setActionError('');
  }

  async function apply() {
    if (!canWrite || busy || !toBlock.length) return;
    setActionError('');
    setBusy(true);
    try {
      if (await onApply(toBlock)) onApplied();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportDates() {
    if (busy || !chosen.length) return;
    setActionError('');
    setBusy(true);
    try {
      await onExport(chosen);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="field">
        <span>Buscar por nombre o fecha</span>
        <input type="search" placeholder="Ej. soberanía o 25/05" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {results.length ? (
        <>
          <button type="button" className="link-button" disabled={busy}
            onClick={() => selectDates(results.map(({ date }) => date), !allVisibleSelected)}>
            {allVisibleSelected ? 'Desmarcar resultados' : 'Seleccionar resultados'} ({results.length})
          </button>
          <ul className="holiday-results" aria-label="Feriados encontrados">
            {results.map(({ date, name, label, typeLabel, status }) => (
              <li key={date}>
                <label className="check">
                  <input type="checkbox" checked={selected.has(date)} disabled={busy}
                    onChange={(e) => selectDates([date], e.target.checked)} />
                  <span>
                    {name}
                    <span className="muted small holiday-date">{[label, typeLabel, status].filter(Boolean).join(' · ')}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="muted small" role="status">No se encontraron feriados con esa búsqueda.</p>}
      <p className="small" role="status">
        {chosen.length === 1 ? '1 feriado seleccionado' : `${chosen.length} feriados seleccionados`}
      </p>
      <div className="row holiday-actions">
        {canWrite && (
          <button type="button" className="btn-primary" disabled={busy || !toBlock.length} onClick={apply}>
            {toBlock.length ? `Bloquear ${toBlock.length} ${toBlock.length === 1 ? 'fecha' : 'fechas'}` : 'Bloquear fechas'}
          </button>
        )}
        <button type="button" disabled={busy || !chosen.length} onClick={exportDates}>Exportar .ics</button>
      </div>
      {actionError && <p className="error-text" role="alert">{actionError}</p>}
    </>
  );
}

export default function ArgentinaHolidays({ token, timezone, overrides, canWrite, onApply, onExport }) {
  const now = DateTime.now();
  const lastYear = now.setZone('America/Argentina/Buenos_Aires').year + 1;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(now.setZone(timezone).year);
  const button = useRef(null);
  const panelId = useId();
  const years = Array.from({ length: lastYear - 2016 + 1 }, (_, i) => lastYear - i);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div className="holiday-picker">
      <button type="button" ref={button} aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(!open)}>Buscar feriados argentinos</button>
      <div id={panelId} hidden={!open}>
        {open && (
          <>
            <label className="field holiday-year">
              <span>Año</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <HolidayResults key={`${token}-${year}`} token={token} year={year} timezone={timezone}
              overrides={overrides} canWrite={canWrite} onApply={onApply} onExport={onExport} onApplied={close} />
            <p className="muted small">Datos de <a href="https://argentinadatos.com" target="_blank" rel="noreferrer">ArgentinaDatos</a>.</p>
          </>
        )}
      </div>
    </div>
  );
}
