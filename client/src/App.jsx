import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import AccountStatus from './pages/AccountStatus';
import EventTypes from './pages/EventTypes';
import EventTypeForm from './pages/EventTypeForm';
import Availability from './pages/Availability';
import Bookings from './pages/Bookings';
import Integrations from './pages/Integrations';
import Profile from './pages/Profile';
import PublicProfile from './public/PublicProfile';
import BookingPage from './public/BookingPage';
import BookingManage from './public/BookingManage';

function FullScreenLoading() {
  return (
    <div className="centered-page">
      <p>Cargando…</p>
    </div>
  );
}

// Las páginas públicas (las que comparte el host y usa el invitado) van ANTES
// del gate de login: no dependen de sesión ni de empresa.
export default function App() {
  return (
    <Routes>
      <Route path="/u/:username" element={<PublicProfile />} />
      <Route path="/u/:username/:slug" element={<BookingPage />} />
      <Route path="/d/:linkToken" element={<BookingPage />} />
      <Route path="/reserva/:uid" element={<BookingManage />} />
      <Route path="*" element={<PrivateApp />} />
    </Routes>
  );
}

// El gate de routing es UI, NO seguridad: todo lo que esconde tiene que estar
// además cerrado del lado del server con la cadena de middleware.
function PrivateApp() {
  const { user, activeMembership, loading } = useAuth();

  if (loading) return <FullScreenLoading />;

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // Con el espacio personal automático (server/src/lib/memberships.js) esto no
  // debería pasar; queda como red por si la membresía activa fue rechazada.
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
        <Route path="/" element={<EventTypes />} />
        <Route path="/eventos/nuevo" element={<EventTypeForm />} />
        <Route path="/eventos/:id" element={<EventTypeForm />} />
        <Route path="/reservas" element={<Bookings />} />
        <Route path="/disponibilidad" element={<Availability />} />
        <Route path="/integraciones" element={<Integrations />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
