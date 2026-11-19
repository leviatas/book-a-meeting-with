import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api } from '../api';
import { LOCATION_LABELS, fmtDay, fmtRange } from '../lib/time';
import PublicShell from './PublicShell';

// Link para que el invitado lo sume a su Google Calendar si el host no tiene
// la integración (si la tiene, ya le llegó la invitación por mail).
function googleTemplateUrl(b) {
  const fmt = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${b.eventType.title} con ${b.host.name}`,
    dates: `${fmt(b.startTime)}/${fmt(b.endTime)}`,
    details: `Gestionar: ${window.location.href.split('?')[0]}`,
    ...(b.meetLink || b.location ? { location: b.meetLink || b.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export default function BookingManage() {
  const { uid } = useParams();
  const [params] = useSearchParams();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(() => {
    api.public
      .booking(uid)
      .then((r) => setBooking(r.booking))
      .catch((err) => setError(err.message));
  }, [uid]);

  useEffect(load, [load]);

  async function cancel() {
    setBusy(true);
    setActionError('');
    try {
      await api.public.cancel(uid, reason);
      setCanceling(false);
      load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <PublicShell><div className="public-card center"><p className="error-text">{error}</p></div></PublicShell>;
  if (!booking) return <PublicShell><p className="muted">Cargando…</p></PublicShell>;

  const zone = booking.inviteeTimezone;
  const isCanceled = booking.status === 'CANCELED';
  const isPast = new Date(booking.endTime) < new Date();
  const editable = !isCanceled && new Date(booking.startTime) > new Date();

  let title = 'Tu reunión';
  if (isCanceled) title = 'Reunión cancelada';
  else if (params.get('nueva')) title = '¡Listo, quedó agendada!';
  else if (params.get('reprogramada')) title = 'Reunión reprogramada';

  return (
    <PublicShell>
      <div className="public-card confirm-card" style={{ '--et-color': booking.eventType.color }}>
        <div className={`confirm-icon${isCanceled ? ' canceled' : ''}`} aria-hidden>
          {isCanceled ? '✕' : '✓'}
        </div>
        <h1 className="center">{title}</h1>
        {!isCanceled && params.get('nueva') && (
          <p className="muted center">Guardá el enlace de esta página para consultar, reprogramar o cancelar tu reserva.</p>
        )}

        <div className={`confirm-details${isCanceled ? ' struck' : ''}`}>
          <h2>{booking.eventType.title}</h2>
          <p>👤 {booking.host.name}</p>
          <p>
            📅 {fmtRange(booking.startTime, booking.endTime, zone)}, {fmtDay(booking.startTime, zone)}
          </p>
          <p>🌐 {zone.replace(/_/g, ' ')}</p>
          {booking.guests.length > 0 && <p>👥 Con {booking.guests.join(', ')}</p>}
          <p>
            📍{' '}
            {booking.meetLink ? (
              <a href={booking.meetLink} target="_blank" rel="noreferrer">
                {booking.meetLink}
              </a>
            ) : (
              booking.location || LOCATION_LABELS[booking.eventType.locationType]
            )}
          </p>
        </div>

        {!isCanceled && booking.eventType.confirmationLinks.length > 0 && (
          <div className="confirm-links">
            {booking.eventType.confirmationLinks.map((l) => (
              <a key={l.url} className="button" href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ))}
          </div>
        )}

        {isCanceled && booking.cancelReason && (
          <p className="muted center">
            Motivo: {booking.cancelReason} ({booking.canceledBy === 'host' ? 'canceló el anfitrión' : 'cancelaste vos'})
          </p>
        )}

        {editable && !canceling && (
          <div className="confirm-actions">
            <a className="button" href={googleTemplateUrl(booking)} target="_blank" rel="noreferrer">
              Agregar a Google Calendar
            </a>
            <Link className="button" to={`/u/${booking.host.username}/${booking.eventType.slug}?reschedule=${uid}`}>
              Reprogramar
            </Link>
            <button type="button" className="btn-danger" onClick={() => setCanceling(true)}>
              Cancelar
            </button>
          </div>
        )}

        {canceling && (
          <div className="cancel-box">
            <label className="field">
              <span>¿Por qué cancelás? (opcional, se le avisa a {booking.host.name})</span>
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {actionError && <p className="error-text">{actionError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setCanceling(false)}>
                Volver
              </button>
              <button type="button" className="btn-danger" disabled={busy} onClick={cancel}>
                Confirmar cancelación
              </button>
            </div>
          </div>
        )}

        {(isCanceled || isPast) && (
          <p className="center">
            {/* Al perfil y no al evento: si se reservó con un link de un solo uso
                o es una reunión única, el evento puede no estar a la vista. */}
            <Link to={`/u/${booking.host.username}`}>Agendar otra reunión</Link>
          </p>
        )}
      </div>
    </PublicShell>
  );
}
