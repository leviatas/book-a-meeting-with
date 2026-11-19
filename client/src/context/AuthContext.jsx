import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'bookameeting_token';
const COMPANY_KEY = 'bookameeting_company_id';

// localStorage puede tirar en modo privado, así que toda lectura va envuelta.
function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {
    /* modo privado */
  }
}

// De las membresías que devuelve el server, cuál queda "activa". Se respeta lo
// guardado si sigue siendo válido; si no, se prioriza una APPROVED (para no
// mandar a una pantalla de espera a alguien que tiene otra empresa aprobada) y
// recién ahí se cae a la primera, para poder mostrar su estado.
function pickCompanyId(memberships, storedId) {
  if (memberships.length === 0) return null;
  if (storedId && memberships.some((m) => m.companyId === storedId)) return storedId;
  const approved = memberships.find((m) => m.status === 'APPROVED');
  return (approved || memberships[0]).companyId;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => readStored(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [companyId, setCompanyId] = useState(() => {
    const initial = Number(readStored(COMPANY_KEY)) || null;
    // Sincrónico a propósito (no en un useEffect): api.js necesita saber la
    // empresa activa ANTES de que se monten los hijos. Los efectos de los
    // hijos corren antes que los del padre, así que su primera carga de datos
    // saldría sin X-Company-Id.
    api.setActiveCompanyId(initial);
    return initial;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    writeStored(COMPANY_KEY, companyId ? String(companyId) : null);
  }, [companyId]);

  const applyMemberships = useCallback((next) => {
    setMemberships(next);
    setCompanyId((current) => {
      const picked = pickCompanyId(next, current);
      api.setActiveCompanyId(picked);
      return picked;
    });
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setMemberships([]);
      setLoading(false);
      return;
    }
    api
      .me(token)
      .then((res) => {
        setUser(res.user);
        applyMemberships(res.memberships);
      })
      .catch(() => {
        writeStored(TOKEN_KEY, null);
        setToken(null);
        setUser(null);
        setMemberships([]);
      })
      .finally(() => setLoading(false));
  }, [token, applyMemberships]);

  const loginWithCredential = useCallback(
    async (credential) => {
      const res = await api.loginWithGoogle(credential);
      writeStored(TOKEN_KEY, res.token);
      setToken(res.token);
      setUser(res.user);
      applyMemberships(res.memberships);
      return res.user;
    },
    [applyMemberships]
  );

  const logout = useCallback(() => {
    writeStored(TOKEN_KEY, null);
    setToken(null);
    setUser(null);
    setMemberships([]);
  }, []);

  const selectCompany = useCallback((id) => {
    api.setActiveCompanyId(id);
    setCompanyId(id);
  }, []);

  const activeMembership = memberships.find((m) => m.companyId === companyId) || null;

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        setUser,
        memberships,
        activeMembership,
        companyId,
        selectCompany,
        applyMemberships,
        loading,
        loginWithCredential,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
