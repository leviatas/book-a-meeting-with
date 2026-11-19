import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api } from '../api';
import TimezoneSelect from '../components/TimezoneSelect';
import { LOCATION_LABELS, browserZone, capitalize, durationLabel, fmtDay, fmtTime, LOCALE } from '../lib/time';
import MonthCalendar from './MonthCalendar';
import PublicShell from './PublicShell';

const OTHER = '__other__';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* modo privado */
  }
}

function parseGuests(text) {
  return [...new Set(String(text || '').split(/[\s,;]+/).map((g) => g.trim().toLowerCase()).filter(Boolean))];
}

// Respuesta lista para mandar: "Otro" se manda como "Otro: <texto>", que es lo
// que el server acepta fuera de la lista de opciones.
function answerValue(q, value, other) {
  const otherText = `Otro: ${String(other || '').trim()}`;
  if (q.type === 'checkbox') return (value || []).map((v) => (v === OTHER ? otherText : v));
  if (q.type === 'radio' && value === OTHER) return otherText;
  return value || '';
}

function QuestionField({ q, value, other, onChange, onOther }) {
  const label = (
    <span>
      {q.label}
      {q.required ? ' *' : ''}
    </span>
  );

  if (q.type === 'radio' || q.type === 'checkbox') {
    const multi = q.type === 'checkbox';
    const selected = multi ? value || [] : value;
    const isOn = (opt) => (multi ? selected.includes(opt) : selected === opt);
    const toggle = (opt) => {
      if (!multi) return onChange(opt);
      onChange(isOn(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]);
    };
    const options = q.allowOther ? [...q.options, OTHER] : q.options;
    return (
      <fieldset className="field choice-field">
        <legend>{label}</legend>
        {options.map((opt) => (
          <label key={opt} className="check">
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={q.id}
              checked={isOn(opt)}
              required={!multi && q.required}
              onChange={() => toggle(opt)}
            />
            <span>{opt === OTHER ? 'Otro' : opt}</span>
          </label>
        ))}
        {isOn(OTHER) && (
          <input value={other || ''} placeholder="¿Cuál?" required onChange={(e) => onOther(e.target.value)} aria-label="Otro" />
        )}
      </fieldset>
    );
  }

  if (q.type === 'select') {
    return (
      <label className="field">
        {label}
        <select value={value || ''} required={q.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elegí una opción</option>
          {q.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="field">
      {label}
      {q.type === 'textarea' ? (
        <textarea rows={3} required={q.required} value={value || ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={q.type === 'phone' ? 'tel' : 'text'}
          autoComplete={q.type === 'phone' ? 'tel' : undefined}
          required={q.required}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

// Sirve tanto /u/:username/:slug como /d/:linkToken (link de un solo uso): el
// flujo es el mismo, cambian sólo los endpoints.
export default function BookingPage() {
  const { username, slug, linkToken } = useParams();
  const [params] = useSearchParams();
  const rescheduleUid = linkToken ? null : params.get('reschedule');
  return (
    <BookingForm
      key={JSON.stringify([username, slug, linkToken, rescheduleUid])}
      {...{ username, slug, linkToken, rescheduleUid }}
    />
  );
}

function BookingForm({ username, slug, linkToken, rescheduleUid }) {
  const navigate = useNavigate();

  const endpoints = useMemo(
    () =>
      linkToken
        ? {
            load: () => api.public.linkEventType(linkToken),
            slots: (q) => api.public.linkSlots(linkToken, q),
            book: (data) => api.public.linkBook(linkToken, data),
          }
        : {
            load: () => api.public.eventType(username, slug, rescheduleUid),
            slots: (q) => api.public.slots(username, slug, { ...q, reschedule: rescheduleUid }),
            book: (data) => api.public.book(username, slug, data),
          },
    [linkToken, username, slug, rescheduleUid]
  );

  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [timezone, setTimezone] = useState(() => browserZone());
  const [hour12, setHour12] = useState(() => readPref('bookameeting_hour12', '0') === '1');
  const [month, setMonth] = useState(() => DateTime.now().setZone(browserZone()).startOf('month'));
  const [slots, setSlots] = useState({});
  const [seatsLeft, setSeatsLeft] = useState({});
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotsError, setSlotsError] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [step, setStep] = useState('pick');
  const [form, setForm] = useState({ name: '', email: '', notes: '', answers: {}, others: {}, guests: '' });
  const [showGuests, setShowGuests] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const autoJumped = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    endpoints
      .load()
      .then((res) => {
        // Zona fijada por el host (reuniones presenciales): manda sobre la del
        // navegador y no se puede cambiar.
        if (res.eventType.lockedTimezone) setTimezone(res.eventType.lockedTimezone);
        setInfo(res);
      })
      .catch((err) => setLoadError(err.message));
  }, [endpoints]);

  // Al cambiar de zona, el mes se recalcula en la zona nueva.
  useEffect(() => {
    setMonth((m) => DateTime.fromObject({ year: m.year, month: m.month, day: 1 }, { zone: timezone }));
    setSelectedSlot(null);
  }, [timezone]);

  useEffect(() => {
    if (!info) return undefined;
    let cancelled = false;
    const today = DateTime.now().setZone(timezone).startOf('day');
    const from = DateTime.max(month.startOf('month'), today);
    const to = month.endOf('month');
    setLoadingSlots(true);
    setSlotsError(false);
    endpoints
      .slots({ from: from.toISODate(), to: to.toISODate(), timezone })
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        setSeatsLeft(res.seatsLeft || {});
        const days = Object.keys(res.slots).sort();
        // Primera carga sin turnos este mes: saltar al siguiente (como Calendly).
        if (days.length === 0 && !autoJumped.current && month.hasSame(DateTime.now().setZone(timezone), 'month')) {
          autoJumped.current = true;
          setMonth((m) => m.plus({ months: 1 }));
          return;
        }
        autoJumped.current = true;
        setSelectedDate((current) => (current && res.slots[current] ? current : days[0] || null));
      })
      .catch(() => {
        if (cancelled) return;
        setSlots({});
        setSelectedDate(null);
        setSlotsError(true);
      })
      .finally(() => !cancelled && setLoadingSlots(false));
    return () => {
      cancelled = true;
    };
  }, [info, endpoints, month, timezone, reloadKey]);

  const available = useMemo(() => new Set(Object.keys(slots)), [slots]);
  const daySlots = (selectedDate && slots[selectedDate]) || [];
  const canPrev = month > DateTime.now().setZone(timezone).startOf('month');

  function toggle12(value) {
    setHour12(value);
    writePref('bookameeting_hour12', value ? '1' : '0');
  }

  async function confirmSlot(slot) {
    if (!rescheduleUid) {
      setSelectedSlot(slot);
      setStep('form');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.public.reschedule(rescheduleUid, slot);
      navigate(`/reserva/${rescheduleUid}?reprogramada=1`);
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
      setReloadKey((k) => k + 1);
    }
  }

  function setAnswer(id, value) {
    setForm((f) => ({ ...f, answers: { ...f.answers, [id]: value } }));
  }
  function setOther(id, value) {
    setForm((f) => ({ ...f, others: { ...f.others, [id]: value } }));
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitError('');
    const { eventType } = info;
    // Casillas obligatorias: el navegador no sabe validar "al menos una".
    const missing = eventType.questions.find(
      (q) => q.type === 'checkbox' && q.required && !(form.answers[q.id] || []).length
    );
    if (missing) return setSubmitError(`Elegí al menos una opción en: ${missing.label}`);
    const guests = parseGuests(form.guests).filter((email) => email !== form.email.trim().toLowerCase());
    const badGuest = guests.find((g) => !EMAIL_RE.test(g));
    if (badGuest) return setSubmitError(`El email ${badGuest} no es válido`);
    if (eventType.kind === 'group' && guests.length + 1 > seatsLeft[selectedSlot]) {
      return setSubmitError('La cantidad de personas supera los lugares disponibles. Quitá invitados o elegí otro horario.');
    }

    const answers = {};
    for (const q of eventType.questions) answers[q.id] = answerValue(q, form.answers[q.id], form.others[q.id]);

    setSubmitting(true);
    try {
      const res = await endpoints.book({
        start: selectedSlot,
        name: form.name,
        email: form.email,
        notes: form.notes,
        answers,
        guests,
        timezone,
      });
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      navigate(`/reserva/${res.uid}?nueva=1`);
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
      // El horario pudo haberse ocupado mientras completaba el form.
      setReloadKey((k) => k + 1);
    }
  }

  if (loadError) {
    return (
      <PublicShell>
        <div className="public-card center">
          <p className="error-text">{loadError}</p>
          {username && <Link to={`/u/${username}`}>Ver otros eventos</Link>}
        </div>
      </PublicShell>
    );
  }
  if (!info) return <PublicShell><p className="muted">Cargando…</p></PublicShell>;

  const { host, eventType } = info;
  const hostPath = `/u/${host.username}`;
  const locked = Boolean(eventType.lockedTimezone);

  const summary = (
    <aside className="booking-aside" style={{ '--et-color': eventType.color }}>
      {step === 'form' && (
        <button type="button" className="icon-button round back" onClick={() => setStep('pick')} aria-label="Volver">
          ←
        </button>
      )}
      {host.avatarUrl && <img className="avatar" src={host.avatarUrl} alt="" referrerPolicy="no-referrer" />}
      <p className="muted">
        <Link to={hostPath} className="muted">
          {host.name}
        </Link>
      </p>
      <h1>{eventType.title}</h1>
      <ul className="meta">
        <li>⏱ {durationLabel(eventType.durationMinutes)}</li>
        <li>📍 {LOCATION_LABELS[eventType.locationType]}</li>
        {eventType.kind === 'group' && <li>👥 Grupal, hasta {eventType.seats} personas</li>}
        {selectedSlot && step === 'form' && (
          <li className="meta-strong">
            📅 {fmtTime(selectedSlot, timezone, hour12)} – {fmtTime(DateTime.fromISO(selectedSlot).plus({ minutes: eventType.durationMinutes }).toISO(), timezone, hour12)},{' '}
            {fmtDay(selectedSlot, timezone)}
          </li>
        )}
        <li>🌐 {timezone.replace(/_/g, ' ')}</li>
      </ul>
      {eventType.description && <p className="description">{eventType.description}</p>}
      {rescheduleUid && <p className="notice">Estás reprogramando una reserva existente.</p>}
    </aside>
  );

  if (step === 'form') {
    return (
      <PublicShell wide>
        <div className="public-card booking-layout two">
          {summary}
          <form className="booking-form" onSubmit={submit}>
            <h2>Completá tus datos</h2>
            <label className="field">
              <span>Nombre *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" />
            </label>
            <label className="field">
              <span>Email *</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
            </label>
            {eventType.allowGuests &&
              (showGuests ? (
                <label className="field">
                  <span>Invitados</span>
                  <textarea
                    rows={2}
                    value={form.guests}
                    placeholder="Emails separados por coma (hasta 10)"
                    onChange={(e) => setForm({ ...form, guests: e.target.value })}
                  />
                  <span className="muted small">
                    {eventType.kind === 'group' ? 'Cada invitado adicional ocupa un lugar.' : 'Sus direcciones quedan incluidas en la reserva.'}
                  </span>
                </label>
              ) : (
                <button type="button" className="btn-link guests-toggle" onClick={() => setShowGuests(true)}>
                  + Sumar invitados
                </button>
              ))}
            {eventType.questions.map((q) => (
              <QuestionField
                key={q.id}
                q={q}
                value={form.answers[q.id]}
                other={form.others[q.id]}
                onChange={(v) => setAnswer(q.id, v)}
                onOther={(v) => setOther(q.id, v)}
              />
            ))}
            <label className="field">
              <span>¿Algo que quieras compartir antes de la reunión?</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            {submitError && (
              <p className="error-text">
                {submitError}{' '}
                <button type="button" className="link-button" onClick={() => setStep('pick')}>
                  Elegir otro horario
                </button>
              </p>
            )}
            <button type="submit" className="btn-primary btn-lg" disabled={submitting}>
              {submitting ? 'Agendando…' : 'Agendar reunión'}
            </button>
          </form>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell wide>
      <div className={`public-card booking-layout${selectedDate ? ' three' : ' two'}`}>
        {summary}
        <div className="booking-calendar">
          <h2>Elegí día y horario</h2>
          <MonthCalendar
            month={month}
            available={available}
            selected={selectedDate}
            loading={loadingSlots}
            canPrev={canPrev}
            onSelect={(d) => {
              setSelectedDate(d);
              setSelectedSlot(null);
            }}
            onPrev={() => setMonth((m) => m.minus({ months: 1 }))}
            onNext={() => setMonth((m) => m.plus({ months: 1 }))}
          />
          {slotsError && (
            <p className="error-text center" role="alert">
              No se pudieron cargar los horarios.{' '}
              <button type="button" className="link-button" onClick={() => setReloadKey((k) => k + 1)}>Reintentar</button>
            </p>
          )}
          {!loadingSlots && !slotsError && available.size === 0 && <p className="muted small center">No hay horarios disponibles este mes.</p>}
          {locked ? (
            <p className="field tz-field muted small">
              Horarios en {timezone.replace(/_/g, ' ')} (zona del lugar de la reunión).
            </p>
          ) : (
            <label className="field tz-field">
              <span>Zona horaria</span>
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </label>
          )}
        </div>
        {!loadingSlots && selectedDate && (
          <div className="booking-slots">
            <div className="slots-head">
              <strong>{capitalize(DateTime.fromISO(selectedDate).setLocale(LOCALE).toFormat('cccc d LLLL'))}</strong>
              <span className="segmented small">
                <button type="button" className={!hour12 ? 'selected' : ''} onClick={() => toggle12(false)}>
                  24 h
                </button>
                <button type="button" className={hour12 ? 'selected' : ''} onClick={() => toggle12(true)}>
                  12 h
                </button>
              </span>
            </div>
            {submitError && <p className="error-text small">{submitError}</p>}
            <div className="slot-list">
              {daySlots.map((s) =>
                selectedSlot === s ? (
                  <div key={s} className="slot-confirm">
                    <span className="slot-chosen">{fmtTime(s, timezone, hour12)}</span>
                    <button type="button" className="btn-primary" disabled={submitting} onClick={() => confirmSlot(s)}>
                      {rescheduleUid ? 'Reprogramar' : 'Siguiente'}
                    </button>
                  </div>
                ) : (
                  <button key={s} type="button" className="slot" onClick={() => setSelectedSlot(s)}>
                    {fmtTime(s, timezone, hour12)}
                    {seatsLeft[s] !== undefined && (
                      <span className="seats">
                        {seatsLeft[s] === 1 ? '1 lugar' : `${seatsLeft[s]} lugares`}
                      </span>
                    )}
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
