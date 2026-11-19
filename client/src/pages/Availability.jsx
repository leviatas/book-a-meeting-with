import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import TimezoneSelect from '../components/TimezoneSelect';
import { LOCALE, capitalize } from '../lib/time';

const DAYS = [
  [1, 'Lunes'],
  [2, 'Martes'],
  [3, 'Miércoles'],
  [4, 'Jueves'],
  [5, 'Viernes'],
  [6, 'Sábado'],
  [0, 'Domingo'],
];

const LIMIT_FIELDS = [
  ['limitDay', 'Por día'],
  ['limitWeek', 'Por semana'],
  ['limitMonth', 'Por mes'],
];

function MeetingLimits() {
  const { token, user, setUser } = useAuth();
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const changes = {};
  for (const [field, value] of Object.entries(edits)) {
    const limit = value === '' ? null : Number(value);
    if (limit !== (user[field] ?? null)) changes[field] = limit;
  }
  const dirty = Object.keys(changes).length > 0;

  function edit(field, value) {
    setEdits((current) => ({ ...current, [field]: value }));
    setSaved(false);
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.profile.update(token, changes);
      setUser(response.user);
      setEdits({});
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel" aria-labelledby="meeting-limits-heading" onSubmit={save}>
      <h2 id="meeting-limits-heading">Límites de reuniones</h2>
      <p className="muted small">
        Elegí cuántas reuniones aceptás entre todos tus tipos de evento. Cada reunión grupal cuenta una vez.
        Los períodos se cuentan en la zona de tu perfil ({user.timezone}). Dejá vacío el período que quieras mantener sin límite.
      </p>
      <div className="grid-3">
        {LIMIT_FIELDS.map(([field, label]) => (
          <label className="field" key={field}>
            <span>{label}</span>
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              placeholder="Sin límite"
              value={edits[field] ?? user[field] ?? ''}
              onChange={(e) => edit(field, e.target.value)}
              disabled={saving}
            />
          </label>
        ))}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions">
        {saved && <span className="success-text" role="status">Límites guardados</span>}
        <button type="submit" className="btn-primary" disabled={saving || !dirty}>
          {saving ? 'Guardando…' : 'Guardar límites'}
        </button>
      </div>
    </form>
  );
}

// Opciones cada 15 minutos, 00:00 … 24:00 (24:00 = fin del día).
const TIMES = Array.from({ length: 97 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

function TimeSelect({ value, onChange, from }) {
  const options = TIMES.filter((t) => (from ? t > from : t !== '24:00'));
  return (
    <select className="input-time" value={value} onChange={(e) => onChange(e.target.value)}>
      {!options.includes(value) && <option value={value}>{value}</option>}
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

function nextInterval(intervals) {
  const last = intervals[intervals.length - 1];
  if (!last) return ['09:00', '17:00'];
  const i = TIMES.indexOf(last[1]);
  const start = TIMES[Math.min(i + 4, 95)];
  const end = TIMES[Math.min(TIMES.indexOf(start) + 4, 96)];
  return [start, end];
}

function Intervals({ intervals, onChange, emptyLabel }) {
  if (intervals.length === 0) return <span className="muted">{emptyLabel}</span>;
  return (
    <div className="intervals">
      {intervals.map(([a, b], i) => (
        <div key={i} className="row nowrap">
          <TimeSelect value={a} onChange={(v) => onChange(intervals.map((x, j) => (j === i ? [v, x[1] > v ? x[1] : nextInterval([[v, v]])[0]] : x)))} />
          <span>–</span>
          <TimeSelect value={b} from={a} onChange={(v) => onChange(intervals.map((x, j) => (j === i ? [x[0], v] : x)))} />
          <button type="button" className="icon-button" aria-label="Quitar" onClick={() => onChange(intervals.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function OverrideModal({ initial, onSave, onClose }) {
  const [date, setDate] = useState(initial?.date || DateTime.now().plus({ days: 1 }).toISODate());
  const [unavailable, setUnavailable] = useState(initial ? initial.intervals.length === 0 : false);
  const [intervals, setIntervals] = useState(initial?.intervals.length ? initial.intervals : [['09:00', '17:00']]);

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Excepción por fecha</h3>
        <p className="muted small">Reemplaza el horario semanal sólo ese día: feriados, vacaciones o un día con horario distinto.</p>
        <label className="field">
          <span>Fecha</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={Boolean(initial)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} />
          No disponible todo el día
        </label>
        {!unavailable && (
          <div className="field">
            <Intervals intervals={intervals} onChange={setIntervals} emptyLabel="Sin horarios" />
            <button type="button" className="link-button" onClick={() => setIntervals([...intervals, nextInterval(intervals)])}>
              + Agregar horario
            </button>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!date}
            onClick={() => onSave({ date, intervals: unavailable ? [] : intervals })}
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleEditor() {
  const { token, user, activeMembership } = useAuth();
  const confirm = useConfirm();
  const canWrite = activeMembership.role !== 'READER';
  const [schedules, setSchedules] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [overrideModal, setOverrideModal] = useState(null);

  const load = useCallback(
    (keepId) =>
      api.schedules
        .list(token)
        .then(({ schedules: list }) => {
          setSchedules(list);
          const pick = list.find((s) => s.id === keepId) || list[0];
          setSelectedId(pick?.id ?? null);
          setDraft(pick ? structuredClone(pick) : null);
          setDirty(false);
        })
        .catch((err) => setError(err.message)),
    [token]
  );

  useEffect(() => {
    load();
  }, [load]);

  function update(patch) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setSaved(false);
  }

  function setDay(day, intervals) {
    update({ weekly: { ...draft.weekly, [day]: intervals } });
  }

  async function select(id) {
    if (dirty) {
      const ok = await confirm({ title: 'Cambios sin guardar', message: 'Vas a perder los cambios de este horario.', confirmLabel: 'Descartar' });
      if (!ok) return;
    }
    const s = schedules.find((x) => x.id === Number(id));
    setSelectedId(s.id);
    setDraft(structuredClone(s));
    setDirty(false);
  }

  async function save() {
    setError('');
    try {
      await api.schedules.update(token, draft.id, {
        name: draft.name,
        timezone: draft.timezone,
        weekly: draft.weekly,
        overrides: draft.overrides,
      });
      await load(draft.id);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createSchedule() {
    try {
      const { schedule } = await api.schedules.create(token, { name: 'Nuevo horario', timezone: user.timezone });
      await load(schedule.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function makeDefault() {
    try {
      await api.schedules.makeDefault(token, draft.id);
      await load(draft.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSchedule() {
    const ok = await confirm({
      title: 'Eliminar horario',
      message: `¿Eliminar "${draft.name}"? Los eventos que lo usan pasan al horario predeterminado.`,
    });
    if (!ok) return;
    try {
      await api.schedules.remove(token, draft.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function applyOverride(o) {
    const rest = draft.overrides.filter((x) => x.date !== o.date);
    update({ overrides: [...rest, o].sort((a, b) => a.date.localeCompare(b.date)) });
    setOverrideModal(null);
  }

  const today = DateTime.now().toISODate();
  const overrides = useMemo(() => (draft ? draft.overrides.filter((o) => o.date >= today) : []), [draft, today]);

  if (!draft) {
    return (
      <section>
        <h1>Disponibilidad</h1>
        {error ? <p className="error-text">{error}</p> : <p className="muted">Cargando…</p>}
      </section>
    );
  }

  return (
    <section>
      <div className="page-header">
        <h1>Disponibilidad</h1>
        <div className="row">
          {schedules.length > 1 && (
            <select value={selectedId} onChange={(e) => select(e.target.value)}>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isDefault ? ' (predeterminado)' : ''}
                </option>
              ))}
            </select>
          )}
          {canWrite && <button type="button" onClick={createSchedule}>+ Nuevo horario</button>}
        </div>
      </div>

      <div className="panel">
        <div className="grid-2">
          <label className="field">
            <span>Nombre</span>
            <input value={draft.name} onChange={(e) => update({ name: e.target.value })} disabled={!canWrite} />
          </label>
          <label className="field">
            <span>Zona horaria</span>
            <TimezoneSelect value={draft.timezone} onChange={(tz) => update({ timezone: tz })} />
          </label>
        </div>
        <div className="row">
          {draft.isDefault ? (
            <span className="badge">Predeterminado</span>
          ) : (
            canWrite && (
              <>
                <button type="button" className="link-button" onClick={makeDefault}>
                  Marcar como predeterminado
                </button>
                <button type="button" className="link-button danger" onClick={removeSchedule}>
                  Eliminar horario
                </button>
              </>
            )
          )}
        </div>
      </div>

      <div className="availability-grid">
        <section className="panel">
          <h2>Horario semanal</h2>
          {DAYS.map(([day, label]) => {
            const intervals = draft.weekly[day] || [];
            return (
              <div key={day} className="day-row">
                <label className="check day-label">
                  <input
                    type="checkbox"
                    checked={intervals.length > 0}
                    disabled={!canWrite}
                    onChange={(e) => setDay(day, e.target.checked ? [['09:00', '17:00']] : [])}
                  />
                  <strong>{label}</strong>
                </label>
                <Intervals intervals={intervals} onChange={(v) => setDay(day, v)} emptyLabel="No disponible" />
                {canWrite && (
                  <button type="button" className="icon-button" aria-label="Agregar horario" onClick={() => setDay(day, [...intervals, nextInterval(intervals)])}>
                    +
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <section className="panel">
          <h2>Excepciones por fecha</h2>
          <p className="muted small">Días en que tu disponibilidad cambia respecto del horario semanal.</p>
          {overrides.length === 0 ? (
            <p className="muted">Sin excepciones.</p>
          ) : (
            <ul className="list">
              {overrides.map((o) => (
                <li key={o.date} className="list-row static">
                  <span>
                    <strong>{capitalize(DateTime.fromISO(o.date).setLocale(LOCALE).toFormat('ccc d LLL yyyy'))}</strong>
                    <br />
                    <span className="muted small">
                      {o.intervals.length === 0 ? 'No disponible' : o.intervals.map(([a, b]) => `${a}–${b}`).join(', ')}
                    </span>
                  </span>
                  {canWrite && (
                    <span className="row nowrap">
                      <button type="button" className="link-button" onClick={() => setOverrideModal(o)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Quitar"
                        onClick={() => update({ overrides: draft.overrides.filter((x) => x.date !== o.date) })}
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <button type="button" onClick={() => setOverrideModal('new')}>
              + Agregar excepción
            </button>
          )}
        </section>
      </div>

      {error && <p className="error-text">{error}</p>}

      {canWrite && (
        <div className="sticky-actions">
          {saved && !dirty && <span className="success-text">Guardado ✓</span>}
          <button type="button" className="btn-primary" disabled={!dirty} onClick={save}>
            Guardar horario
          </button>
        </div>
      )}

      {overrideModal && (
        <OverrideModal
          initial={overrideModal === 'new' ? null : overrideModal}
          onSave={applyOverride}
          onClose={() => setOverrideModal(null)}
        />
      )}
    </section>
  );
}

export default function Availability() {
  return (
    <div className="page">
      <ScheduleEditor />
      <MeetingLimits />
    </div>
  );
}
