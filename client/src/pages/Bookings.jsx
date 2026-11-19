import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { browserZone, capitalize, fmtDay, fmtRange } from '../lib/time';

const TABS = [
  ['upcoming', 'Próximas'],
  ['past', 'Pasadas'],
  ['canceled', 'Canceladas'],
];

function CancelModal({ booking, onDone, onClose }) {
  const { token } = useAuth();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.bookings.cancel(token, booking.id, reason);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Cancelar reunión</h3>
        <p>
          {booking.eventType.title} con <strong>{booking.inviteeName}</strong>
        </p>
        <label className="field">
          <span>Motivo (se le avisa al invitado)</span>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" autoFocus onClick={onClose}>
            Volver
          </button>
          <button type="button" className="btn-danger" disabled={busy} onClick={submit}>
            Cancelar reunión
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Bookings() {
  const { token, activeMembership } = useAuth();
  const zone = browserZone();
  const [scope, setScope] = useState('upcoming');
  // Reservas de todo el equipo (?all=1): el server lo soporta para cuando haya
  // equipos; con espacios personales no hay nada que mostrar.
  const all = false;
  const [bookings, setBookings] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [canceling, setCanceling] = useState(null);
  const [error, setError] = useState('');
  const canWrite = activeMembership.role !== 'READER';

  const load = useCallback(() => {
    setBookings(null);
    api.bookings
      .list(token, scope, all)
      .then((r) => setBookings(r.bookings))
      .catch((err) => setError(err.message));
  }, [token, scope, all]);

  useEffect(load, [load]);

  // Agrupadas por día (en la zona del navegador del host).
  const groups = [];
  for (const b of bookings || []) {
    const day = fmtDay(b.startTime, zone);
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(b);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reservas</h1>
      </div>

      <div className="segmented">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" className={scope === k ? 'selected' : ''} onClick={() => setScope(k)}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}

      {bookings === null ? (
        <p className="muted">Cargando…</p>
      ) : bookings.length === 0 ? (
        <div className="empty">
          <p>No hay reservas {TABS.find(([k]) => k === scope)[1].toLowerCase()}.</p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.day} className="section">
            <h3 className="day-heading">{capitalize(g.day)}</h3>
            <ul className="list">
              {g.items.map((b) => (
                <li key={b.id} className="booking-row" style={{ '--et-color': b.eventType.color }}>
                  <button type="button" className="booking-summary" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                    <span className="dot" />
                    <span className="booking-time">{fmtRange(b.startTime, b.endTime, zone)}</span>
                    <span className="booking-main">
                      <strong>{b.inviteeName}</strong>
                      <span className="muted small">
                        {b.eventType.title}
                        {all && b.host ? ` · ${b.host.name}` : ''}
                      </span>
                    </span>
                    <span className="muted small">{expanded === b.id ? '▲' : '▼'}</span>
                  </button>
                  {expanded === b.id && (
                    <div className="booking-detail">
                      <p>
                        <strong>Email:</strong> <a href={`mailto:${b.inviteeEmail}`}>{b.inviteeEmail}</a>
                      </p>
                      {b.guests.length > 0 && (
                        <p>
                          <strong>Invitados:</strong> {b.guests.join(', ')}
                        </p>
                      )}
                      <p>
                        <strong>Zona del invitado:</strong> {b.inviteeTimezone}
                      </p>
                      {(b.meetLink || b.location) && (
                        <p>
                          <strong>Ubicación:</strong>{' '}
                          {b.meetLink ? (
                            <a href={b.meetLink} target="_blank" rel="noreferrer">
                              {b.meetLink}
                            </a>
                          ) : (
                            b.location
                          )}
                        </p>
                      )}
                      {b.eventType.questions.map((q) =>
                        b.answers[q.id] ? (
                          <p key={q.id}>
                            <strong>{q.label}:</strong> {b.answers[q.id]}
                          </p>
                        ) : null
                      )}
                      {b.notes && (
                        <p>
                          <strong>Notas:</strong> {b.notes}
                        </p>
                      )}
                      {b.rescheduleCount > 0 && <p className="muted small">Reprogramada {b.rescheduleCount} vez/veces.</p>}
                      {b.status === 'CANCELED' && (
                        <p className="error-text">
                          Cancelada por {b.canceledBy === 'host' ? 'el anfitrión' : 'el invitado'}
                          {b.cancelReason ? `: ${b.cancelReason}` : ''}
                        </p>
                      )}
                      {scope === 'upcoming' && canWrite && (
                        <button type="button" className="btn-danger" onClick={() => setCanceling(b)}>
                          Cancelar reunión
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {canceling && (
        <CancelModal
          booking={canceling}
          onClose={() => setCanceling(null)}
          onDone={() => {
            setCanceling(null);
            load();
          }}
        />
      )}
    </div>
  );
}
