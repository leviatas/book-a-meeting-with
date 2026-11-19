const prisma = require('./prisma');

// Lo piden /auth/google, /auth/me y /companies/:id/join: junto con el usuario
// devuelven todas las empresas a las que pertenece (o pidió pertenecer) y con
// qué rol/estado en cada una. Es lo que el cliente usa para armar el combo de
// empresas y decidir a qué pantalla mandarlo.
async function loadMembershipsForUser(userId) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { company: { name: 'asc' } },
  });

  return rows.map((m) => ({
    id: m.id,
    companyId: m.companyId,
    companyName: m.company.name,
    role: m.role,
    status: m.status,
  }));
}

// Un superadmin (email en ADMIN_EMAILS) nunca tiene que esperar aprobación: si
// la empresa a la que pidió acceso todavía no tiene ningún admin aprobado,
// esperar es un deadlock — no existe nadie que pueda aprobarlo. Se llama al
// resolver el usuario (login y /auth/me), así una membresía que ya quedó
// pendiente se destraba sola en el próximo request, sin tocar la base a mano.
//
// Sólo promueve las PENDING: una REJECTED es una decisión explícita de un
// admin de esa empresa y no se pisa.
async function ensureSuperAdminMemberships(user) {
  if (!user.isSuperAdmin) return;

  const pending = await prisma.membership.findMany({
    where: { userId: user.id, status: 'PENDING' },
  });
  if (pending.length === 0) return;

  await prisma.membership.updateMany({
    where: { id: { in: pending.map((m) => m.id) } },
    data: { role: 'ADMIN', status: 'APPROVED' },
  });
}

module.exports = { loadMembershipsForUser, ensureSuperAdminMemberships };
