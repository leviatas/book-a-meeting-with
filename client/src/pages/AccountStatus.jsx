import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const STATUS_TEXT = {
  PENDING: 'Tu pedido de acceso está esperando que lo apruebe un administrador de esa empresa.',
  REJECTED: 'Un administrador rechazó tu pedido de acceso a esa empresa.',
};

// Tres situaciones en una pantalla: no pediste acceso a ninguna empresa,
// estás esperando aprobación, o te rechazaron.
export default function AccountStatus() {
  const { user, token, memberships, activeMembership, selectCompany, applyMemberships, logout } =
    useAuth();
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCompany, setNewCompany] = useState('');

  useEffect(() => {
    api.companies
      .listPublic()
      .then((res) => setCompanies(res.companies))
      .catch((err) => setError(err.message));
  }, []);

  async function join(companyId) {
    setBusy(true);
    setError('');
    try {
      const res = await api.companies.join(token, companyId);
      applyMemberships(res.memberships);
      selectCompany(companyId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createCompany(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.companies.create(token, newCompany.trim());
      applyMemberships(res.memberships);
      selectCompany(res.company.id);
      setNewCompany('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Una empresa a la que ya se le pidió acceso no se vuelve a ofrecer.
  const requested = new Set(memberships.map((m) => m.companyId));
  const available = companies.filter((c) => !requested.has(c.id));

  return (
    <div className="centered-page">
      <div className="card">
        <h1>Hola, {user.name}</h1>

        {activeMembership ? (
          <p className="muted">
            <strong>{activeMembership.companyName}</strong>:{' '}
            {STATUS_TEXT[activeMembership.status] || 'Estado desconocido.'}
          </p>
        ) : (
          <p className="muted">Todavía no pediste acceso a ninguna empresa.</p>
        )}

        {memberships.length > 1 && (
          <div className="section">
            <h3>Tus empresas</h3>
            {memberships.map((m) => (
              <button
                key={m.companyId}
                type="button"
                className="list-row"
                onClick={() => selectCompany(m.companyId)}
              >
                {m.companyName} <span className="muted">— {m.status}</span>
              </button>
            ))}
          </div>
        )}

        {available.length > 0 && (
          <div className="section">
            <h3>Pedir acceso a una empresa</h3>
            {available.map((c) => (
              <button
                key={c.id}
                type="button"
                className="list-row"
                disabled={busy}
                onClick={() => join(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {user.isSuperAdmin && (
          <form className="section" onSubmit={createCompany}>
            <h3>Crear una empresa</h3>
            <div className="row">
              <input
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                placeholder="Nombre de la empresa"
                required
              />
              <button type="submit" disabled={busy || !newCompany.trim()}>
                Crear
              </button>
            </div>
          </form>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="button" className="link-button" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
