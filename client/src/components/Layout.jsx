import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, memberships, activeMembership, selectCompany, logout } = useAuth();
  const approved = memberships.filter((m) => m.status === 'APPROVED');

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <strong>Book a Meeting</strong>
          {approved.length > 1 && (
            <select
              className="brand-select"
              value={activeMembership.companyId}
              onChange={(e) => selectCompany(Number(e.target.value))}
            >
              {approved.map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.companyName}
                </option>
              ))}
            </select>
          )}
        </div>

        <nav className="tabs">
          <NavLink to="/" end>
            Eventos
          </NavLink>
          <NavLink to="/reservas">Reservas</NavLink>
          <NavLink to="/disponibilidad">Disponibilidad</NavLink>
          <NavLink to="/integraciones">Integraciones</NavLink>
          <NavLink to="/perfil">Perfil</NavLink>
        </nav>

        <div className="user-box">
          {user.avatarUrl && <img className="avatar avatar-sm" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
          <span className="muted">{user.name}</span>
          <button type="button" className="link-button" onClick={logout}>
            Salir
          </button>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      {/* La versión sale de client/package.json vía Vite (__APP_VERSION__).
          Subirla en cada cambio, junto con la de server/package.json. */}
      <footer className="app-footer">
        <span className="muted">v{__APP_VERSION__}</span>
      </footer>
    </div>
  );
}
