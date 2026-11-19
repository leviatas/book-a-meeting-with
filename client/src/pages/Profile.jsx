import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import TimezoneSelect from '../components/TimezoneSelect';

export default function Profile() {
  const { token, user, setUser } = useAuth();
  const [form, setForm] = useState({
    name: user.name,
    username: user.username || '',
    timezone: user.timezone,
    welcomeMessage: user.welcomeMessage || '',
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await api.profile.update(token, form);
      setUser(res.user);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page narrow">
      <h1>Perfil</h1>
      <form className="panel form" onSubmit={save}>
        <label className="field">
          <span>Nombre visible</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="field">
          <span>Tu link</span>
          <div className="input-prefix">
            <span className="muted">{window.location.origin}/u/</span>
            <input
              value={form.username}
              onChange={(e) => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              required
            />
          </div>
          <small className="muted">Si lo cambiás, los links que ya compartiste dejan de funcionar.</small>
        </label>
        <label className="field">
          <span>Zona horaria</span>
          <TimezoneSelect value={form.timezone} onChange={(tz) => set('timezone', tz)} />
          <small className="muted">Es la zona con la que se crean los horarios nuevos.</small>
        </label>
        <label className="field">
          <span>Mensaje de bienvenida</span>
          <textarea
            rows={3}
            value={form.welcomeMessage}
            placeholder="¡Hola! Elegí el tipo de reunión que necesites."
            onChange={(e) => set('welcomeMessage', e.target.value)}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="form-actions">
          {saved && <span className="success-text">Guardado ✓</span>}
          <button type="submit" className="btn-primary" disabled={saving}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
