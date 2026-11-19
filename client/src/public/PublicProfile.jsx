import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { LOCATION_LABELS, durationLabel } from '../lib/time';
import PublicShell from './PublicShell';

export default function PublicProfile() {
  const { username } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.public
      .profile(username)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [username]);

  if (error) return <PublicShell><p className="error-text">{error}</p></PublicShell>;
  if (!data) return <PublicShell><p className="muted">Cargando…</p></PublicShell>;

  return (
    <PublicShell>
      <div className="public-card profile-card">
        <div className="profile-head">
          {data.host.avatarUrl && <img className="avatar avatar-lg" src={data.host.avatarUrl} alt="" referrerPolicy="no-referrer" />}
          <h1>{data.host.name}</h1>
          <p className="muted">{data.host.welcomeMessage || 'Elegí el tipo de reunión que querés agendar.'}</p>
        </div>
        {data.eventTypes.length === 0 ? (
          <p className="muted center">No hay eventos disponibles por ahora.</p>
        ) : (
          <div className="public-et-list">
            {data.eventTypes.map((et) => (
              <Link key={et.id} className="public-et" to={`/u/${username}/${et.slug}`} style={{ '--et-color': et.color }}>
                <span className="dot" />
                <span>
                  <strong>{et.title}</strong>
                  <span className="muted small">
                    {durationLabel(et.durationMinutes)} · {LOCATION_LABELS[et.locationType]}
                  </span>
                </span>
                <span aria-hidden>›</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
