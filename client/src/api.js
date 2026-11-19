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

  items: {
    list: (token) => request('/items', { token }),
    create: (token, data) => request('/items', { method: 'POST', body: data, token }),
    update: (token, id, data) => request(`/items/${id}`, { method: 'PUT', body: data, token }),
    remove: (token, id) => request(`/items/${id}`, { method: 'DELETE', token }),
  },
};
