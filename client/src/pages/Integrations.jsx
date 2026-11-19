import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';

const RESULT_MESSAGES = {
  ok: ['success', 'Google Calendar quedó conectado.'],
  denied: ['error', 'Cancelaste la conexión con Google.'],
  scopes: ['error', 'Hace falta aceptar los permisos de calendario para que funcione. Probá de nuevo y dejá tildados todos.'],
  invalid: ['error', 'La conexión expiró o no es válida. Probá de nuevo.'],
  error: ['error', 'No se pudo conectar con Google. Probá de nuevo.'],
};

export default function Integrations() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [result] = useState(() => RESULT_MESSAGES[params.get('google')] || null);

  const load = useCallback(() => {
    api.google
      .status(token)
      .then(setStatus)
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    load();
    // Limpia el ?google=… de la URL para que un refresh no repita el aviso.
    if (params.get('google')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function connect() {
    setError('');
    try {
      const { url } = await api.google.connect(token);
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'Desconectar Google Calendar',
      message: 'Tus horarios dejan de bloquearse con los eventos de Google y las reservas nuevas no se agregan a tu calendario.',
      confirmLabel: 'Desconectar',
    });
    if (!ok) return;
    try {
      await api.google.disconnect(token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveSettings(patch) {
    setSaved(false);
    setStatus((s) => ({ ...s, ...patch }));
    try {
      await api.google.updateSettings(token, patch);
      setSaved(true);
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  function toggleConflict(id) {
    const current = status.conflictCalendarIds;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    saveSettings({ conflictCalendarIds: next });
  }

  // "primary" es el alias del calendario principal: se marca como tildado el
  // calendario con primary=true aunque el id guardado sea el alias.
  const isChecked = (cal) =>
    status.conflictCalendarIds.includes(cal.id) || (cal.primary && status.conflictCalendarIds.includes('primary'));
  const targetValue = (cal) => (cal.primary ? 'primary' : cal.id);
  const writable = (status?.calendars || []).filter((c) => ['owner', 'writer'].includes(c.accessRole));

  return (
    <div className="page narrow">
      <h1>Integraciones</h1>

      {result && <p className={result[0] === 'success' ? 'notice success' : 'notice error'}>{result[1]}</p>}
      {error && <p className="error-text">{error}</p>}

      <section className="panel">
        <div className="integration-head">
          <div className="gcal-logo" aria-hidden>
            31
          </div>
          <div>
            <h2>Google Calendar</h2>
            <p className="muted small">
              Bloquea tus horarios ocupados y agrega cada reserva a tu calendario. Elegí Google Meet en el evento para crear el enlace de videollamada.
            </p>
          </div>
        </div>

        {status === null ? (
          <p className="muted">Cargando…</p>
        ) : !status.enabled ? (
          <p className="notice error">
            La integración no está habilitada en este servidor: falta configurar <code>GOOGLE_CLIENT_SECRET</code>.
          </p>
        ) : !status.connected ? (
          <button type="button" className="btn-primary" onClick={connect}>
            Conectar Google Calendar
          </button>
        ) : (
          <>
            <p>
              Conectado como <strong>{status.googleEmail}</strong>{' '}
              <button type="button" className="link-button danger" onClick={disconnect}>
                Desconectar
              </button>
            </p>
            {status.error && (
              <p className="notice error">
                Google respondió con un error: {status.error}.{' '}
                <button type="button" className="link-button" onClick={connect}>
                  Reconectar
                </button>
              </p>
            )}

            <h3>Revisar conflictos en</h3>
            <p className="muted small">Los eventos de estos calendarios bloquean tu disponibilidad.</p>
            <ul className="list">
              {status.calendars.map((cal) => (
                <li key={cal.id} className="list-row static">
                  <label className="check">
                    <input type="checkbox" checked={isChecked(cal)} onChange={() => toggleConflict(cal.primary && status.conflictCalendarIds.includes('primary') ? 'primary' : cal.id)} />
                    <span className="cal-dot" style={{ background: cal.backgroundColor }} />
                    {cal.summary}
                    {cal.primary && <span className="badge">Principal</span>}
                  </label>
                </li>
              ))}
            </ul>

            <h3>Agregar las reservas a</h3>
            <select value={status.targetCalendarId} onChange={(e) => saveSettings({ targetCalendarId: e.target.value })}>
              {writable.map((cal) => (
                <option key={cal.id} value={targetValue(cal)}>
                  {cal.summary}
                </option>
              ))}
            </select>

            <h3>Sincronización</h3>
            <label className="check">
              <input type="checkbox" checked={status.syncFromGoogle} onChange={(e) => saveSettings({ syncFromGoogle: e.target.checked })} />
              <span>
                Actualizar la reserva si muevo o borro la reunión en Google Calendar. Los cambios se revisan cada cinco minutos.
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={status.includeBuffers} onChange={(e) => saveSettings({ includeBuffers: e.target.checked })} />
              <span>Mostrar los márgenes de reuniones individuales y únicas como bloques en el calendario</span>
            </label>
            {saved && <p className="success-text small">Guardado ✓</p>}
          </>
        )}
      </section>
    </div>
  );
}
