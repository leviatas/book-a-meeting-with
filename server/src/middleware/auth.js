const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET;

function signToken(user) {
  return jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Multi-empresa: toda ruta de datos necesita saber "como qué empresa" está
// operando el usuario. El cliente manda el id en el header X-Company-Id (ver
// client/src/api.js); acá se valida que exista una Membership para ese
// (usuario, empresa) y se cuelga en req.membership / req.company, que es de
// donde el resto de la cadena lee el rol y el estado — nunca de req.user.
async function requireCompany(req, res, next) {
  const companyId = Number(req.headers['x-company-id']);
  if (!companyId) return res.status(400).json({ error: 'Falta la empresa (header X-Company-Id)' });

  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: req.user.id, companyId } },
    include: { company: true },
  });
  if (!membership) return res.status(403).json({ error: 'No tenés acceso a esa empresa' });

  req.membership = membership;
  req.company = membership.company;
  next();
}

function requireApproved(req, res, next) {
  if (req.membership.status !== 'APPROVED') {
    return res.status(403).json({ error: 'Tu cuenta todavía no fue aprobada por un administrador de esta empresa' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.membership.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Se requiere perfil de administrador' });
  }
  next();
}

// READER es de solo lectura: ve todo lo de su empresa pero no escribe nada.
// Se aplica EXPLÍCITAMENTE en cada ruta que escribe (POST/PUT/DELETE), nunca
// en un router.use(...) global, para que los GET sigan abiertos a cualquier
// membresía aprobada.
function requireWriter(req, res, next) {
  if (req.membership.role === 'READER') {
    return res.status(403).json({ error: 'Tu perfil es de solo lectura' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ error: 'Se requiere perfil de superadmin' });
  }
  next();
}

module.exports = {
  signToken,
  requireAuth,
  requireCompany,
  requireApproved,
  requireAdmin,
  requireWriter,
  requireSuperAdmin,
};
