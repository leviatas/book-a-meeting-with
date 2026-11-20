// Nullish coalescing (NO ||): el build de Docker pasa VITE_API_URL="" a
// propósito para que el cliente llame same-origin /api/* (nginx lo proxea al
// server). "" es falsy, así que || volvería al default localhost:4000, que no
// es alcanzable desde afuera de la red de Docker. Este bug exacto rompe el
// login en Docker mientras anda bien con `npm run dev`. Si tocás este archivo,
// dejá el ??.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// Multi-empresa: casi todas las rutas necesitan saber con qué empresa está
// operando el usuario. En vez de agregar companyId a la firma de cada función
// (y tocar cada llamador), AuthContext avisa acá cuál es la activa cada vez
// que cambia, y todas las requests mandan el header.
let activeCompanyId = null;
function setActiveCompanyId(id) {
  activeCompanyId = id || null;
}

function companyHeaders() {
  return activeCompanyId ? { 'X-Company-Id': String(activeCompanyId) } : {};
}

async function request(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...companyHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Los uploads no pasan por request(): no llevan Content-Type JSON. Igual
// necesitan el Authorization, así que tampoco alcanza un <form> común.
async function upload(path, files, token, fields = {}) {
  const body = new FormData();
  Object.entries(fields).forEach(([key, value]) => body.append(key, value));
  Array.from(files).forEach((file) => body.append('files', file));

  const res = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...companyHeaders() },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  setActiveCompanyId,
  upload,

  loginWithGoogle: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),
  me: (token) => request('/auth/me', { token }),

  companies: {
    listPublic: () => request('/companies/public'),
    join: (token, companyId) => request(`/companies/${companyId}/join`, { method: 'POST', token }),
    listAll: (token) => request('/companies', { token }),
    create: (token, name) => request('/companies', { method: 'POST', body: { name }, token }),
  },

  admin: {
    listMembers: (token, status) =>
      request(`/admin/members${status ? `?status=${status}` : ''}`, { token }),
    updateMember: (token, id, data) =>
      request(`/admin/members/${id}`, { method: 'POST', body: data, token }),
  },

  eventTypes: {
    list: (token) => request('/event-types', { token }),
    get: (token, id) => request(`/event-types/${id}`, { token }),
    create: (token, data) => request('/event-types', { method: 'POST', body: data, token }),
    update: (token, id, data) => request(`/event-types/${id}`, { method: 'PUT', body: data, token }),
    duplicate: (token, id) => request(`/event-types/${id}/duplicate`, { method: 'POST', token }),
    remove: (token, id) => request(`/event-types/${id}`, { method: 'DELETE', token }),
  },

  schedules: {
    list: (token) => request('/schedules', { token }),
    argentinaHolidays: (token, year) => request(`/schedules/holidays/argentina/${year}`, { token }),
    create: (token, data) => request('/schedules', { method: 'POST', body: data, token }),
    update: (token, id, data) => request(`/schedules/${id}`, { method: 'PUT', body: data, token }),
    makeDefault: (token, id) => request(`/schedules/${id}/default`, { method: 'POST', token }),
    remove: (token, id) => request(`/schedules/${id}`, { method: 'DELETE', token }),
  },

  bookings: {
    list: (token, scope, all) => request(`/bookings?scope=${scope}${all ? '&all=1' : ''}`, { token }),
    cancel: (token, id, reason) => request(`/bookings/${id}/cancel`, { method: 'POST', body: { reason }, token }),
  },

  google: {
    status: (token) => request('/google/status', { token }),
    connect: (token) => request('/google/connect', { token }),
    updateSettings: (token, data) => request('/google/settings', { method: 'PUT', body: data, token }),
    disconnect: (token) => request('/google', { method: 'DELETE', token }),
  },

  profile: {
    update: (token, data) => request('/profile', { method: 'PUT', body: data, token }),
  },

  singleUseLinks: {
    list: (token) => request('/single-use-links', { token }),
    create: (token, eventTypeId) => request('/single-use-links', { method: 'POST', body: { eventTypeId }, token }),
    remove: (token, id) => request(`/single-use-links/${id}`, { method: 'DELETE', token }),
  },

  // Sin token: páginas públicas de reserva y gestión del invitado.
  public: {
    profile: (username) => request(`/public/u/${encodeURIComponent(username)}`),
    eventType: (username, slug, reschedule) =>
      request(
        `/public/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}` +
          (reschedule ? `?reschedule=${encodeURIComponent(reschedule)}` : '')
      ),
    slots: (username, slug, { from, to, timezone, reschedule }) =>
      request(
        `/public/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/slots?` +
          new URLSearchParams({ from, to, timezone, ...(reschedule ? { reschedule } : {}) })
      ),
    book: (username, slug, data) =>
      request(`/public/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/book`, {
        method: 'POST',
        body: data,
      }),
    // Link de un solo uso: mismo flujo que un tipo de evento, por token.
    linkEventType: (token) => request(`/public/d/${encodeURIComponent(token)}`),
    linkSlots: (token, { from, to, timezone }) =>
      request(`/public/d/${encodeURIComponent(token)}/slots?` + new URLSearchParams({ from, to, timezone })),
    linkBook: (token, data) => request(`/public/d/${encodeURIComponent(token)}/book`, { method: 'POST', body: data }),
    booking: (uid) => request(`/public/bookings/${encodeURIComponent(uid)}`),
    cancel: (uid, reason) =>
      request(`/public/bookings/${encodeURIComponent(uid)}/cancel`, { method: 'POST', body: { reason } }),
    reschedule: (uid, start) =>
      request(`/public/bookings/${encodeURIComponent(uid)}/reschedule`, { method: 'POST', body: { start } }),
  },
};
