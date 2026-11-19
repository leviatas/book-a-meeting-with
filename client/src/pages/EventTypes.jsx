import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import { LOCATION_LABELS, durationLabel, fmtDay, fmtTime } from '../lib/time';

function publicUrl(path) {
  return `${window.location.origin}${path}`;
}

function ManualCopyDialog({ url, onClose }) {
  const dialog = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    input.current.focus();
    input.current.select();
  }, []);

  return (
    <dialog className="modal copy-dialog" ref={dialog} onClose={onClose} aria-labelledby="copy-title">
      <h2 id="copy-title">Copiá el enlace manualmente</h2>
      <label className="field">
        <span>Enlace para compartir</span>
        <input ref={input} type="text" readOnly value={url} onClick={(e) => e.currentTarget.select()} />
      </label>
      <div className="modal-actions">
        <button type="button" onClick={() => dialog.current.close()}>Cerrar</button>
      </div>
    </dialog>
  );
}

export default function EventTypes() {
  const { token, user, activeMembership } = useAuth();
  return (
    <EventTypesPanel key={activeMembership.companyId} token={token} user={user} canWrite={activeMembership.role !== 'READER'} />
  );
}

function EventTypesPanel({ token, user, canWrite }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [eventTypes, setEventTypes] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);
  const [manualUrl, setManualUrl] = useState('');
  const [creatingFirst, setCreatingFirst] = useState(false);
  const [creatingLinkId, setCreatingLinkId] = useState(null);
  const [links, setLinks] = useState([]);
  const zone = user.timezone || 'UTC';

  const load = useCallback(() => {
    setError('');
    api.eventTypes
      .list(token)
      .then((res) => setEventTypes(res.eventTypes))
      .catch((err) => setError(err.message));
    api.singleUseLinks
      .list(token)
      .then((res) => setLinks(res.links))
      .catch(() => {});
  }, [token]);

  useEffect(load, [load]);

  async function onCopy(key, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setCopied(null);
      setManualUrl(text);
    }
  }

  async function createFirstMeeting() {
    setCreatingFirst(true);
    setError('');
    try {
      const { eventType } = await api.eventTypes.create(token, {
        title: 'Reunión de 30 minutos',
        durationMinutes: 30,
        locationType: 'none',
      });
      setEventTypes([eventType]);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingFirst(false);
    }
  }

  async function toggle(et) {
    try {
      await api.eventTypes.update(token, et.id, { isActive: !et.isActive });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function duplicate(et) {
    try {
      const res = await api.eventTypes.duplicate(token, et.id);
      navigate(`/eventos/${res.eventType.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  // Calendly: "Single-use link". Se crea y se copia de una: es lo que el host
  // quiere hacer el 100% de las veces.
  async function createLink(et) {
    setCreatingLinkId(et.id);
    try {
      const { link } = await api.singleUseLinks.create(token, et.id);
      setLinks((l) => [link, ...l]);
      await onCopy(`link-${et.id}`, link.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingLinkId(null);
    }
  }

  async function removeLink(link) {
    const ok = await confirm({
      title: 'Eliminar link',
      message: 'El link deja de funcionar. Si ya se usó, la reserva no se toca.',
    });
    if (!ok) return;
    try {
      await api.singleUseLinks.remove(token, link.id);
      setLinks((l) => l.filter((x) => x.id !== link.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(et) {
    const ok = await confirm({
      title: 'Eliminar tipo de evento',
      message: `¿Eliminar "${et.title}"? Si ya tiene reservas, se desactiva en lugar de borrarse.`,
    });
    if (!ok) return;
    try {
      await api.eventTypes.remove(token, et.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const profilePath = `/u/${user.username}`;

  return (
    <div className="page event-types-page">
      <div className="page-header">
        <div>
          <h1>Tipos de evento</h1>
          <p className="muted small">
            Tu página pública:{' '}
            <a href={profilePath} target="_blank" rel="noreferrer">
              {publicUrl(profilePath)}
            </a>{' '}
            <button type="button" className="link-button" onClick={() => onCopy('profile', publicUrl(profilePath))}>
              {copied === 'profile' ? '¡Copiado!' : 'Copiar'}
            </button>
          </p>
        </div>
        {canWrite && (
          <div className="row">
            <Link className={eventTypes?.length === 0 ? 'button' : 'button btn-primary'} to="/eventos/nuevo">
              + Nuevo evento
            </Link>
            <Link className="button" to="/eventos/nuevo?tipo=grupal">
              + Grupal
            </Link>
            <Link className="button" to="/eventos/nuevo?tipo=unica">
              + Reunión única
            </Link>
          </div>
        )}
      </div>

      {error && <p role="alert" className="error-text">{error}</p>}

      {eventTypes === null ? (
        error
          ? <button type="button" onClick={load}>Volver a cargar</button>
          : <p className="muted">Cargando…</p>
      ) : eventTypes.length === 0 ? (
        canWrite ? (
          <section className="panel first-meeting">
            <h2>Creá tu primer tipo de evento</h2>
            <p>Ofrecé una reunión individual con tu horario de disponibilidad y la ubicación a definir.</p>
            <button type="button" className="btn-primary" disabled={creatingFirst} onClick={createFirstMeeting}>
              {creatingFirst ? 'Creando…' : 'Crear reunión de 30 minutos'}
            </button>
          </section>
        ) : (
          <p className="empty">Todavía no hay tipos de evento en este espacio.</p>
        )
      ) : (
        <div className="et-grid">
          {eventTypes.map((et) => {
            const path = `/u/${user.username}/${et.slug}`;
            return (
              <div key={et.id} className={`et-card${et.isActive ? '' : ' is-off'}`} style={{ '--et-color': et.color }}>
                <div className="et-card-body">
                  <div className="et-card-top">
                    <h3>{et.title}</h3>
                    {canWrite && (
                      <label className="switch" title={et.isActive ? 'Activo' : 'Inactivo'}>
                        <input type="checkbox" aria-label={`Activar ${et.title}`} checked={et.isActive} onChange={() => toggle(et)} />
                        <span />
                      </label>
                    )}
                  </div>
                  <p className="muted small">
                    {durationLabel(et.durationMinutes)} · {LOCATION_LABELS[et.locationType]}
                  </p>
                  <div className="badges">
                    {et.kind === 'group' && <span className="badge">Grupal · {et.seats} lugares</span>}
                    {et.kind === 'one_off' && <span className="badge">Reunión única</span>}
                    {!et.isActive && <span className="badge">Inactivo</span>}
                    {et.isSecret && et.kind !== 'one_off' && <span className="badge">Oculto</span>}
                  </div>
                  {et.isActive && (
                    <a className="small" href={path} target="_blank" rel="noreferrer">
                      {publicUrl(path)}
                    </a>
                  )}
                </div>
                <div className="et-card-actions">
                  {et.isActive && (
                    <button type="button" className="link-button" onClick={() => onCopy(et.id, publicUrl(path))}>
                      {copied === et.id ? '¡Copiado!' : 'Copiar link'}
                    </button>
                  )}
                  {canWrite && et.isActive && et.kind !== 'one_off' && (
                    <button type="button" className="link-button" disabled={creatingLinkId !== null} onClick={() => createLink(et)}>
                      {creatingLinkId === et.id ? 'Creando…' : copied === `link-${et.id}` ? '¡Link copiado!' : 'Crear link de un solo uso'}
                    </button>
                  )}
                  {canWrite && (
                    <span className="row">
                      <Link to={`/eventos/${et.id}`}>Editar</Link>
                      <button type="button" className="link-button" onClick={() => duplicate(et)}>
                        Duplicar
                      </button>
                      <button type="button" className="link-button danger" onClick={() => remove(et)}>
                        Eliminar
                      </button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {links.length > 0 && (
        <section className="single-links">
          <h2>Links de un solo uso</h2>
          <p className="muted small">Sirven para una sola reserva. Después de usarse dejan de funcionar.</p>
          <ul className="list">
            {links.map((l) => (
              <li key={l.id} className="list-row">
                <span className="dot" style={{ background: l.eventType.color }} />
                <div className="grow">
                  <strong>{l.eventType.title}</strong>
                  <div className="muted small">
                    {l.booking
                      ? `Usado por ${l.booking.inviteeName} · ${fmtDay(l.booking.startTime, zone)} ${fmtTime(l.booking.startTime, zone)}`
                      : l.usedAt
                        ? 'Usado'
                        : 'Sin usar'}
                  </div>
                  {!l.usedAt && (
                    <a className="small" href={l.url} target="_blank" rel="noreferrer">{l.url}</a>
                  )}
                </div>
                {!l.usedAt && (
                  <button type="button" className="link-button" onClick={() => onCopy(`sul-${l.id}`, l.url)}>
                    {copied === `sul-${l.id}` ? '¡Copiado!' : 'Copiar'}
                  </button>
                )}
                {canWrite && (
                  <button type="button" className="link-button danger" onClick={() => removeLink(l)}>
                    Eliminar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {manualUrl && <ManualCopyDialog url={manualUrl} onClose={() => setManualUrl('')} />}
    </div>
  );
}
