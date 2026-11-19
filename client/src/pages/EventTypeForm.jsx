import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { LOCATION_LABELS, LOCALE } from '../lib/time';

const DURATIONS = [15, 30, 45, 60, 90];
const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0891b2', '#475569'];
const BUFFERS = [0, 5, 10, 15, 30, 45, 60, 90, 120];
const QUESTION_TYPES = {
  text: 'Una línea',
  textarea: 'Varias líneas',
  radio: 'Opción única',
  checkbox: 'Casillas (varias)',
  select: 'Desplegable',
  phone: 'Teléfono',
};
const OPTION_TYPES = ['radio', 'checkbox', 'select'];
const KINDS = {
  one_on_one: { label: 'Uno a uno', hint: 'Un invitado por turno.' },
  group: { label: 'Grupal', hint: 'Varios invitados en el mismo turno (talleres, clases).' },
  one_off: { label: 'Reunión única', hint: 'Elegís los horarios a mano; se cierra con la primera reserva.' },
};
const KIND_FROM_QUERY = { grupal: 'group', unica: 'one_off' };
const REMINDER_OPTIONS = [15, 30, 60, 120, 240, 1440, 2880, 10080];
const FOLLOW_UP_OPTIONS = [0, 30, 60, 120, 1440, 2880];

const EMPTY = {
  kind: 'one_on_one',
  seats: 10,
  oneOffSlots: [],
  title: '',
  slug: '',
  description: '',
  color: COLORS[0],
  durationMinutes: 30,
  locationType: 'google_meet',
  locationValue: '',
  scheduleId: '',
  bufferBefore: 0,
  bufferAfter: 0,
  minNoticeMinutes: 240,
  maxDaysAhead: 60,
  slotInterval: '',
  dailyLimit: '',
  weeklyLimit: '',
  monthlyLimit: '',
  isSecret: false,
  lockTimezone: false,
  allowGuests: true,
  questions: [],
  redirectUrl: '',
  confirmationLinks: [],
  reminders: [],
  followUpMinutes: '',
  followUpMessage: '',
  isActive: true,
};

function slugify(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// El aviso mínimo se guarda en minutos; en la UI se elige número + unidad.
function splitNotice(min) {
  if (min && min % 1440 === 0) return { n: min / 1440, unit: 1440 };
  if (min && min % 60 === 0) return { n: min / 60, unit: 60 };
  return { n: min, unit: 1 };
}

export function minutesLabel(min) {
  if (min === 0) return 'Apenas termina';
  if (min % 10080 === 0) return min === 10080 ? '1 semana' : `${min / 10080} semanas`;
  if (min % 1440 === 0) return min === 1440 ? '1 día' : `${min / 1440} días`;
  if (min % 60 === 0) return min === 60 ? '1 hora' : `${min / 60} horas`;
  return `${min} minutos`;
}

const emptyToNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export default function EventTypeForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const hostZone = user.timezone || 'UTC';
  const [form, setForm] = useState(() => ({ ...EMPTY, kind: KIND_FROM_QUERY[params.get('tipo')] || 'one_on_one' }));
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [schedules, setSchedules] = useState([]);
  const [customDuration, setCustomDuration] = useState(false);
  const [notice, setNotice] = useState(splitNotice(EMPTY.minNoticeMinutes));
  const [afterBooking, setAfterBooking] = useState('confirm');
  const [newSlot, setNewSlot] = useState({ date: '', time: '10:00' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    api.schedules.list(token).then((r) => setSchedules(r.schedules)).catch(() => {});
    if (isNew) return;
    api.eventTypes
      .get(token, id)
      .then(({ eventType }) => {
        setForm({
          ...EMPTY,
          ...eventType,
          seats: eventType.seats ?? EMPTY.seats,
          description: eventType.description || '',
          locationValue: eventType.locationValue || '',
          scheduleId: eventType.scheduleId ?? '',
          slotInterval: eventType.slotInterval ?? '',
          dailyLimit: eventType.dailyLimit ?? '',
          weeklyLimit: eventType.weeklyLimit ?? '',
          monthlyLimit: eventType.monthlyLimit ?? '',
          redirectUrl: eventType.redirectUrl || '',
          followUpMinutes: eventType.followUpMinutes ?? '',
          followUpMessage: eventType.followUpMessage || '',
        });
        setAfterBooking(eventType.redirectUrl ? 'redirect' : 'confirm');
        setCustomDuration(!DURATIONS.includes(eventType.durationMinutes));
        setNotice(splitNotice(eventType.minNoticeMinutes));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, id, isNew]);

  function set(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === 'title' && !slugTouched) next.slug = slugify(value);
      return next;
    });
  }

  // ---- Preguntas ----
  function setQuestion(i, patch) {
    setForm((f) => ({ ...f, questions: f.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  }
  function addQuestion() {
    setForm((f) => ({
      ...f,
      questions: [
        ...f.questions,
        { id: `q${Date.now().toString(36)}`, label: '', type: 'text', required: false, enabled: true, options: [], allowOther: false },
      ],
    }));
  }
  function removeQuestion(i) {
    setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }));
  }
  function moveQuestion(i, dir) {
    setForm((f) => {
      const qs = [...f.questions];
      const j = i + dir;
      if (j < 0 || j >= qs.length) return f;
      [qs[i], qs[j]] = [qs[j], qs[i]];
      return { ...f, questions: qs };
    });
  }
  function setQuestionType(i, type) {
    const q = form.questions[i];
    const needsOptions = OPTION_TYPES.includes(type) && (!q.options || q.options.length === 0);
    setQuestion(i, { type, ...(needsOptions ? { options: ['', ''] } : {}), ...(type === 'select' ? { allowOther: false } : {}) });
  }
  function setOption(i, k, value) {
    setQuestion(i, { options: form.questions[i].options.map((o, j) => (j === k ? value : o)) });
  }

  // ---- Links de la confirmación ----
  function setLink(i, patch) {
    setForm((f) => ({ ...f, confirmationLinks: f.confirmationLinks.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  }

  // ---- Reunión única: horarios en la zona del host ----
  function addOneOffSlot() {
    if (!newSlot.date || !newSlot.time) return;
    const t = DateTime.fromISO(`${newSlot.date}T${newSlot.time}`, { zone: hostZone });
    if (!t.isValid) return;
    const iso = t.toUTC().toISO({ suppressMilliseconds: true });
    setForm((f) => ({ ...f, oneOffSlots: [...new Set([...f.oneOffSlots, iso])].sort() }));
  }

  // ---- Recordatorios ----
  function setReminder(i, value) {
    setForm((f) => ({ ...f, reminders: f.reminders.map((r, j) => (j === i ? Number(value) : r)) }));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = {
      ...form,
      minNoticeMinutes: Number(notice.n || 0) * notice.unit,
      scheduleId: form.scheduleId === '' ? null : Number(form.scheduleId),
      slotInterval: emptyToNull(form.slotInterval),
      dailyLimit: emptyToNull(form.dailyLimit),
      weeklyLimit: emptyToNull(form.weeklyLimit),
      monthlyLimit: emptyToNull(form.monthlyLimit),
      seats: form.kind === 'group' ? Number(form.seats) : null,
      questions: form.questions.map((q) => ({
        ...q,
        options: OPTION_TYPES.includes(q.type) ? q.options.map((o) => o.trim()).filter(Boolean) : [],
      })),
      redirectUrl: afterBooking === 'redirect' ? form.redirectUrl.trim() : '',
      confirmationLinks: afterBooking === 'confirm' ? form.confirmationLinks : [],
      followUpMinutes: emptyToNull(form.followUpMinutes),
    };
    try {
      if (isNew) await api.eventTypes.create(token, payload);
      else await api.eventTypes.update(token, id, payload);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) return <div className="page"><p className="muted">Cargando…</p></div>;

  const isOneOff = form.kind === 'one_off';
  const needsValue = ['phone', 'in_person', 'custom'].includes(form.locationType);
  const valuePlaceholder = {
    phone: 'Tu número, ej. +54 9 11 5555-5555',
    in_person: 'Dirección',
    custom: 'https://zoom.us/j/…',
  }[form.locationType];

  return (
    <div className="page narrow">
      <p>
        <Link to="/">← Volver</Link>
      </p>
      <h1>{isNew ? 'Nuevo tipo de evento' : 'Editar tipo de evento'}</h1>

      <form className="form" onSubmit={save}>
        <section className="panel">
          <h2>Tipo de reunión</h2>
          <div className="kind-picker">
            {Object.entries(KINDS).map(([k, v]) => (
              <button
                key={k}
                type="button"
                className={`kind-option${form.kind === k ? ' selected' : ''}`}
                onClick={() => set('kind', k)}
                aria-pressed={form.kind === k}
              >
                <strong>{v.label}</strong>
                <span className="muted small">{v.hint}</span>
              </button>
            ))}
          </div>
          {form.kind === 'group' && (
            <label className="field">
              <span>Invitados por turno</span>
              <input type="number" className="input-sm" min={2} max={500} value={form.seats} onChange={(e) => set('seats', e.target.value)} />
            </label>
          )}
          {isOneOff && (
            <div className="field">
              <span>Horarios que ofrecés ({hostZone.replace(/_/g, ' ')})</span>
              {form.oneOffSlots.length === 0 && <p className="muted small">Todavía no agregaste horarios.</p>}
              <ul className="oneoff-slots">
                {form.oneOffSlots.map((iso) => (
                  <li key={iso}>
                    <span>{DateTime.fromISO(iso, { zone: 'utc' }).setZone(hostZone).setLocale(LOCALE).toFormat("ccc d 'de' LLL, HH:mm")}</span>
                    <button
                      type="button"
                      className="btn-danger"
                      aria-label="Quitar horario"
                      onClick={() => set('oneOffSlots', form.oneOffSlots.filter((s) => s !== iso))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="row">
                <input type="date" value={newSlot.date} onChange={(e) => setNewSlot((s) => ({ ...s, date: e.target.value }))} />
                <input type="time" value={newSlot.time} onChange={(e) => setNewSlot((s) => ({ ...s, time: e.target.value }))} />
                <button type="button" onClick={addOneOffSlot} disabled={!newSlot.date}>
                  + Agregar
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Detalles</h2>
          <label className="field">
            <span>Nombre del evento</span>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Charla de 30 minutos" required />
          </label>

          <label className="field">
            <span>Link</span>
            <div className="input-prefix">
              <span className="muted">/u/{user.username}/</span>
              <input
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set('slug', slugify(e.target.value));
                }}
                required
              />
            </div>
          </label>

          <label className="field">
            <span>Descripción / instrucciones</span>
            <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>

          <div className="field">
            <span>Color</span>
            <div className="row">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch${form.color === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  aria-label={c}
                  onClick={() => set('color', c)}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <span>Duración</span>
            <div className="row">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`pill${!customDuration && form.durationMinutes === d ? ' selected' : ''}`}
                  onClick={() => {
                    setCustomDuration(false);
                    set('durationMinutes', d);
                  }}
                >
                  {d} min
                </button>
              ))}
              <button type="button" className={`pill${customDuration ? ' selected' : ''}`} onClick={() => setCustomDuration(true)}>
                Otra
              </button>
              {customDuration && (
                <input
                  type="number"
                  className="input-sm"
                  min={5}
                  max={720}
                  value={form.durationMinutes}
                  onChange={(e) => set('durationMinutes', Number(e.target.value))}
                />
              )}
            </div>
          </div>

          <label className="field">
            <span>Ubicación</span>
            <select value={form.locationType} onChange={(e) => set('locationType', e.target.value)}>
              {Object.entries(LOCATION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {form.locationType === 'google_meet' && (
            <p className="muted small">
              El link de Meet se genera solo al reservar si tenés Google Calendar conectado en Integraciones.
            </p>
          )}
          {needsValue && (
            <label className="field">
              <span>{LOCATION_LABELS[form.locationType]}</span>
              <input value={form.locationValue} onChange={(e) => set('locationValue', e.target.value)} placeholder={valuePlaceholder} />
            </label>
          )}
        </section>

        <section className="panel">
          <h2>Disponibilidad y límites</h2>
          {!isOneOff && (
            <>
              <label className="field">
                <span>Horario</span>
                <select value={form.scheduleId} onChange={(e) => set('scheduleId', e.target.value)}>
                  <option value="">Usar el predeterminado</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.isDefault ? ' (predeterminado)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">
                Editá los horarios en <Link to="/disponibilidad">Disponibilidad</Link>. Los topes entre todos tus eventos se
                configuran ahí también.
              </p>
            </>
          )}

          <div className="grid-2">
            <label className="field">
              <span>Aviso mínimo</span>
              <div className="row nowrap">
                <input
                  type="number"
                  className="input-sm"
                  min={0}
                  value={notice.n}
                  onChange={(e) => setNotice((n) => ({ ...n, n: e.target.value }))}
                />
                <select value={notice.unit} onChange={(e) => setNotice((n) => ({ ...n, unit: Number(e.target.value) }))}>
                  <option value={1}>minutos</option>
                  <option value={60}>horas</option>
                  <option value={1440}>días</option>
                </select>
              </div>
            </label>
            {!isOneOff && (
              <label className="field">
                <span>Se puede reservar hasta</span>
                <div className="row nowrap">
                  <input
                    type="number"
                    className="input-sm"
                    min={1}
                    max={365}
                    value={form.maxDaysAhead}
                    onChange={(e) => set('maxDaysAhead', e.target.value)}
                  />
                  <span className="muted">días adelante</span>
                </div>
              </label>
            )}
            <label className="field">
              <span>Margen antes del evento</span>
              <select value={form.bufferBefore} onChange={(e) => set('bufferBefore', Number(e.target.value))}>
                {BUFFERS.map((b) => (
                  <option key={b} value={b}>
                    {b ? `${b} min` : 'Sin margen'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Margen después del evento</span>
              <select value={form.bufferAfter} onChange={(e) => set('bufferAfter', Number(e.target.value))}>
                {BUFFERS.map((b) => (
                  <option key={b} value={b}>
                    {b ? `${b} min` : 'Sin margen'}
                  </option>
                ))}
              </select>
            </label>
            {!isOneOff && (
              <label className="field">
                <span>Los turnos empiezan cada</span>
                <select value={form.slotInterval} onChange={(e) => set('slotInterval', e.target.value)}>
                  <option value="">Lo que dura el evento</option>
                  {[5, 10, 15, 20, 30, 45, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} min
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {!isOneOff && (
            <div className="field">
              <span>Máximo de reuniones de este evento</span>
              <div className="grid-3">
                <label className="field">
                  <span className="muted small">Por día</span>
                  <input type="number" min={1} max={100} placeholder="Sin límite" value={form.dailyLimit} onChange={(e) => set('dailyLimit', e.target.value)} />
                </label>
                <label className="field">
                  <span className="muted small">Por semana</span>
                  <input type="number" min={1} max={500} placeholder="Sin límite" value={form.weeklyLimit} onChange={(e) => set('weeklyLimit', e.target.value)} />
                </label>
                <label className="field">
                  <span className="muted small">Por mes</span>
                  <input type="number" min={1} max={2000} placeholder="Sin límite" value={form.monthlyLimit} onChange={(e) => set('monthlyLimit', e.target.value)} />
                </label>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Página de reserva</h2>
          {!isOneOff && (
            <label className="check">
              <input type="checkbox" checked={form.isSecret} onChange={(e) => set('isSecret', e.target.checked)} />
              <span>
                Oculto: no aparece en tu página pública, sólo se entra con el link directo
              </span>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={form.lockTimezone} onChange={(e) => set('lockTimezone', e.target.checked)} />
            <span>Mostrar los horarios siempre en mi zona horaria (útil para reuniones presenciales)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.allowGuests} onChange={(e) => set('allowGuests', e.target.checked)} />
            <span>Permitir que el invitado sume a otras personas</span>
          </label>
        </section>

        <section className="panel">
          <h2>Preguntas al invitado</h2>
          <p className="muted small">Nombre y email se piden siempre. Sumá las que necesites.</p>
          {form.questions.map((q, i) => (
            <div key={q.id} className={`question-card${q.enabled ? '' : ' disabled'}`}>
              <div className="question-row">
                <input value={q.label} placeholder="Pregunta" onChange={(e) => setQuestion(i, { label: e.target.value })} required />
                <select value={q.type} onChange={(e) => setQuestionType(i, e.target.value)}>
                  {Object.entries(QUESTION_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <span className="row nowrap">
                  <button type="button" onClick={() => moveQuestion(i, -1)} disabled={i === 0} aria-label="Subir">
                    ↑
                  </button>
                  <button type="button" onClick={() => moveQuestion(i, 1)} disabled={i === form.questions.length - 1} aria-label="Bajar">
                    ↓
                  </button>
                  <button type="button" className="btn-danger" onClick={() => removeQuestion(i)} aria-label="Quitar">
                    ✕
                  </button>
                </span>
              </div>

              {OPTION_TYPES.includes(q.type) && (
                <div className="options-editor">
                  {q.options.map((o, k) => (
                    <div key={k} className="row nowrap">
                      <input value={o} placeholder={`Opción ${k + 1}`} onChange={(e) => setOption(i, k, e.target.value)} />
                      <button
                        type="button"
                        className="btn-danger"
                        aria-label="Quitar opción"
                        onClick={() => setQuestion(i, { options: q.options.filter((_, j) => j !== k) })}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn-link" onClick={() => setQuestion(i, { options: [...q.options, ''] })}>
                    + Agregar opción
                  </button>
                  {q.type !== 'select' && (
                    <label className="check">
                      <input type="checkbox" checked={q.allowOther} onChange={(e) => setQuestion(i, { allowOther: e.target.checked })} />
                      <span>Incluir “Otro” con texto libre</span>
                    </label>
                  )}
                </div>
              )}

              <div className="row">
                <label className="check">
                  <input type="checkbox" checked={q.required} onChange={(e) => setQuestion(i, { required: e.target.checked })} />
                  <span>Obligatoria</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={q.enabled} onChange={(e) => setQuestion(i, { enabled: e.target.checked })} />
                  <span>Activa</span>
                </label>
              </div>
            </div>
          ))}
          <button type="button" onClick={addQuestion}>
            + Agregar pregunta
          </button>
        </section>

        <section className="panel">
          <h2>Después de reservar</h2>
          <div className="row">
            <label className="check">
              <input type="radio" name="after" checked={afterBooking === 'confirm'} onChange={() => setAfterBooking('confirm')} />
              <span>Mostrar la página de confirmación</span>
            </label>
            <label className="check">
              <input type="radio" name="after" checked={afterBooking === 'redirect'} onChange={() => setAfterBooking('redirect')} />
              <span>Redirigir a otra página</span>
            </label>
          </div>
          {afterBooking === 'redirect' ? (
            <label className="field">
              <span>URL</span>
              <input
                type="url"
                value={form.redirectUrl}
                placeholder="https://tusitio.com/gracias"
                onChange={(e) => set('redirectUrl', e.target.value)}
                required
              />
            </label>
          ) : (
            <div className="field">
              <span>Links en la confirmación</span>
              {form.confirmationLinks.map((l, i) => (
                <div key={i} className="link-row">
                  <input value={l.label} placeholder="Texto, ej. Ver el temario" onChange={(e) => setLink(i, { label: e.target.value })} required />
                  <input type="url" value={l.url} placeholder="https://…" onChange={(e) => setLink(i, { url: e.target.value })} required />
                  <button
                    type="button"
                    className="btn-danger"
                    aria-label="Quitar link"
                    onClick={() => set('confirmationLinks', form.confirmationLinks.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {form.confirmationLinks.length < 5 && (
                <button type="button" className="btn-link" onClick={() => set('confirmationLinks', [...form.confirmationLinks, { label: '', url: '' }])}>
                  + Agregar link
                </button>
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Notificaciones</h2>
          <p className="muted small">
            Los mails salen sólo si el server tiene SMTP configurado. Con Google Calendar conectado, Google además manda la
            invitación y sus propios avisos.
          </p>
          <div className="field">
            <span>Recordatorios al invitado</span>
            {form.reminders.map((r, i) => (
              <div key={i} className="row nowrap">
                <select value={r} onChange={(e) => setReminder(i, e.target.value)}>
                  {REMINDER_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {minutesLabel(m)} antes
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-danger"
                  aria-label="Quitar recordatorio"
                  onClick={() => set('reminders', form.reminders.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            {form.reminders.length < 3 && (
              <button
                type="button"
                className="btn-link"
                onClick={() => set('reminders', [...form.reminders, REMINDER_OPTIONS.find((m) => !form.reminders.includes(m)) || 1440])}
              >
                + Agregar recordatorio
              </button>
            )}
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={form.followUpMinutes !== ''}
              onChange={(e) => set('followUpMinutes', e.target.checked ? 60 : '')}
            />
            <span>Mandar un mail de seguimiento después de la reunión</span>
          </label>
          {form.followUpMinutes !== '' && (
            <>
              <label className="field">
                <span>Cuándo</span>
                <select value={form.followUpMinutes} onChange={(e) => set('followUpMinutes', Number(e.target.value))}>
                  {FOLLOW_UP_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'Apenas termina' : `${minutesLabel(m)} después`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Mensaje</span>
                <textarea
                  rows={3}
                  value={form.followUpMessage}
                  placeholder="¡Gracias por la reunión! Si querés volver a agendar, respondé este mail."
                  onChange={(e) => set('followUpMessage', e.target.value)}
                />
              </label>
            </>
          )}
        </section>

        {error && <p className="error-text">{error}</p>}

        <div className="form-actions">
          <Link to="/">Cancelar</Link>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
