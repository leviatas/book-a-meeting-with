const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const google = require('../lib/google');
const { requireAuth } = require('../middleware/auth');
const { parseJson } = require('../lib/serialize');

const router = express.Router();

// Conexión con Google Calendar. Es personal (no por empresa), así que sólo
// requireAuth: no pide X-Company-Id.

const STATE_TTL = '10m';

function stateFor(userId) {
  // El state firma QUIÉN pidió conectar: el callback llega por redirect del
  // browser, sin Authorization header, y sin esto cualquiera podría pegarle su
  // código a la cuenta de otro.
  return jwt.sign({ userId, purpose: 'gcal' }, process.env.JWT_SECRET, { expiresIn: STATE_TTL });
}

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    if (!google.isEnabled()) return res.json({ enabled: false, connected: false });
    const connection = await prisma.googleConnection.findUnique({ where: { userId: req.user.id } });
    if (!connection) return res.json({ enabled: true, connected: false, redirectUri: google.redirectUri() });

    let calendars = [];
    let error = connection.lastError;
    try {
      calendars = await google.listCalendars(connection);
      error = null;
    } catch (e) {
      error = (await prisma.googleConnection.findUnique({ where: { userId: req.user.id } })).lastError;
    }
    res.json({
      enabled: true,
      connected: true,
      googleEmail: connection.googleEmail,
      conflictCalendarIds: parseJson(connection.conflictCalendarIdsJson, ['primary']),
      targetCalendarId: connection.targetCalendarId,
      includeBuffers: connection.includeBuffers,
      syncFromGoogle: connection.syncFromGoogle,
      lastSyncAt: connection.lastSyncAt,
      calendars,
      error,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/connect', requireAuth, (req, res) => {
  if (!google.isEnabled()) {
    return res.status(400).json({ error: 'Falta configurar GOOGLE_CLIENT_SECRET en el server' });
  }
  res.json({ url: google.authUrl(stateFor(req.user.id)) });
});

// Google redirige acá el browser. Respuesta = redirect a la SPA.
router.get('/callback', async (req, res) => {
  const back = (status) => res.redirect(`${google.publicOrigin()}/integraciones?google=${status}`);
  if (req.query.error) return back('denied');

  let userId;
  try {
    const payload = jwt.verify(String(req.query.state || ''), process.env.JWT_SECRET);
    if (payload.purpose !== 'gcal') throw new Error('state');
    userId = payload.userId;
  } catch (e) {
    return back('invalid');
  }

  try {
    const { tokens, email } = await google.exchangeCode(String(req.query.code || ''));
    const scopes = String(tokens.scope || '');
    if (!scopes.includes('calendar.events') || !scopes.includes('calendar.readonly')) {
      // La persona destildó permisos en la pantalla de consentimiento.
      return back('scopes');
    }
    await google.saveConnection(userId, tokens, email);
    back('ok');
  } catch (err) {
    console.error('Callback de Google Calendar:', err.message);
    back('error');
  }
});

router.put('/settings', requireAuth, async (req, res, next) => {
  try {
    const connection = await prisma.googleConnection.findUnique({ where: { userId: req.user.id } });
    if (!connection) return res.status(404).json({ error: 'Google Calendar no está conectado' });

    const data = {};
    if (req.body.conflictCalendarIds !== undefined) {
      if (!Array.isArray(req.body.conflictCalendarIds)) return res.status(400).json({ error: 'Lista inválida' });
      data.conflictCalendarIdsJson = JSON.stringify(req.body.conflictCalendarIds.map(String).slice(0, 50));
    }
    if (req.body.targetCalendarId !== undefined) {
      data.targetCalendarId = String(req.body.targetCalendarId || 'primary');
    }
    if (req.body.includeBuffers !== undefined) data.includeBuffers = Boolean(req.body.includeBuffers);
    if (req.body.syncFromGoogle !== undefined) {
      data.syncFromGoogle = Boolean(req.body.syncFromGoogle);
      // Al prenderla se lee desde ahora: no se reprocesa lo que cambió mientras
      // estaba apagada.
      if (data.syncFromGoogle && !connection.syncFromGoogle) data.lastSyncAt = new Date();
    }
    await prisma.googleConnection.update({ where: { id: connection.id }, data });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/', requireAuth, async (req, res, next) => {
  try {
    const connection = await prisma.googleConnection.findUnique({ where: { userId: req.user.id } });
    if (connection) {
      await google.revoke(connection);
      await prisma.googleConnection.delete({ where: { id: connection.id } });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
