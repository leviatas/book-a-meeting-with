require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const companiesRoutes = require('./routes/companies');
const adminRoutes = require('./routes/admin');
const eventTypesRoutes = require('./routes/eventTypes');
const schedulesRoutes = require('./routes/schedules');
const bookingsRoutes = require('./routes/bookings');
const googleRoutes = require('./routes/google');
const profileRoutes = require('./routes/profile');
const publicRoutes = require('./routes/public');
const singleUseLinksRoutes = require('./routes/singleUseLinks');
const { startJobs } = require('./lib/jobs');

// Fallar temprano y con un mensaje claro: sin estas dos variables la app
// arranca igual y recién falla en el primer login, que es mucho peor de
// diagnosticar.
if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en las variables de entorno. Revisá server/.env');
  process.exit(1);
}
if (!process.env.GOOGLE_CLIENT_ID) {
  console.error('Falta GOOGLE_CLIENT_ID en las variables de entorno. Revisá server/.env');
  process.exit(1);
}

if (!process.env.GOOGLE_CLIENT_SECRET) {
  console.warn('GOOGLE_CLIENT_SECRET no está configurado: la integración con Google Calendar queda deshabilitada.');
}

const app = express();

// Detrás de nginx (y de cloudflared): sin esto req.ip es siempre la IP del
// contenedor de nginx y el rate limit de las rutas públicas sería uno solo
// para todo internet. Se confía sólo en saltos de redes privadas (la red de
// Compose), no en cualquier X-Forwarded-For.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Un solo origen, no un wildcard. Tiene que coincidir EXACTO con la URL desde
// la que el browser carga el cliente (en Docker, CLIENT_ORIGIN del .env).
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// Lo usa el HEALTHCHECK del Dockerfile.
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/event-types', eventTypesRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/google', googleRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/single-use-links', singleUseLinksRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  startJobs();
});
