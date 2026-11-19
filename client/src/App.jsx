import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import AccountStatus from './pages/AccountStatus';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';

function FullScreenLoading() {
  return (
    <div className="centered-page">
      <p>Cargando…</p>
    </div>
  );
}

// El gate de routing es UI, NO seguridad: todo lo que esconde tiene que estar
// además cerrado del lado del server con la cadena de middleware. Cualquiera
// puede pegarle a un endpoint con curl y un token válido.
export default function App() {
  const { user, activeMembership, loading } = useAuth();

  if (loading) return <FullScreenLoading />;

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // Cubre tanto "sin ninguna empresa todavía" (activeMembership null) como
  // "pendiente/rechazado en la empresa activa".
  if (!activeMembership || activeMembership.status !== 'APPROVED') {
    return (
      <Routes>
        <Route path="*" element={<AccountStatus />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/admin"
          element={activeMembership.role === 'ADMIN' ? <Admin /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
