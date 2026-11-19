const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../lib/prisma');
const { signToken, requireAuth } = require('../middleware/auth');
const {
  loadMembershipsForUser,
  ensureSuperAdminMemberships,
  ensurePersonalWorkspace,
} = require('../lib/memberships');
const { ensureUsername } = require('../lib/users');

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Registro abierto como en Calendly, salvo que ALLOWED_EMAILS tenga algo:
// ahí sólo entran esos emails o dominios ("@miempresa.com"), además de los
// de ADMIN_EMAILS. Se chequea en cada login y en /me, así sacar a alguien de
// la lista le corta el acceso aunque tenga un JWT vigente.
const ALLOWED = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAllowed(email) {
  if (ALLOWED.length === 0 || ADMIN_EMAILS.includes(email)) return true;
  return ALLOWED.some((rule) => (rule.startsWith('@') ? email.endsWith(rule) : email === rule));
}

const NOT_ALLOWED = 'Esta instalación es privada: tu cuenta no tiene acceso.';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    username: user.username,
    timezone: user.timezone,
    welcomeMessage: user.welcomeMessage,
    limitDay: user.limitDay,
    limitWeek: user.limitWeek,
    limitMonth: user.limitMonth,
  };
}

// El cliente obtiene el ID token con Google Identity Services y lo manda acá.
// El server lo verifica contra Google (audience = GOOGLE_CLIENT_ID): nunca
// confía en la identidad que manda el cliente. El login NO otorga acceso a
// ninguna empresa: sólo crea/actualiza el User y su flag de superadmin. A qué
// empresa pertenece se define por Membership (ver routes/companies.js).
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Falta el credential de Google' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: 'Token de Google inválido' });
  }
  if (!payload || !payload.email) {
    return res.status(401).json({ error: 'No se pudo verificar la cuenta de Google' });
  }

  const email = payload.email.toLowerCase();
  if (!isAllowed(email)) return res.status(403).json({ error: NOT_ALLOWED });
  const isSuperAdmin = ADMIN_EMAILS.includes(email);

  let user =
    (await prisma.user.findUnique({ where: { googleId: payload.sub } })) ||
    (await prisma.user.findUnique({ where: { email } }));

  if (!user) {
    user = await prisma.user.create({
      data: {
        googleId: payload.sub,
        email,
        name: payload.name || email,
        avatarUrl: payload.picture,
        isSuperAdmin,
      },
    });
  } else if (isSuperAdmin !== user.isSuperAdmin || user.googleId !== payload.sub) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { isSuperAdmin, googleId: payload.sub, avatarUrl: payload.picture },
    });
  }

  user = await ensureUsername(user);
  const token = signToken(user);
  await ensureSuperAdminMemberships(user);
  await ensurePersonalWorkspace(user);
  res.json({
    token,
    user: serializeUser(user),
    memberships: await loadMembershipsForUser(user.id),
  });
});

router.get('/me', requireAuth, async (req, res) => {
  if (!isAllowed(req.user.email)) return res.status(403).json({ error: NOT_ALLOWED });
  await ensureSuperAdminMemberships(req.user);
  await ensurePersonalWorkspace(req.user);
  const user = await ensureUsername(req.user);
  res.json({
    user: serializeUser(user),
    memberships: await loadMembershipsForUser(req.user.id),
  });
});

module.exports = router;
