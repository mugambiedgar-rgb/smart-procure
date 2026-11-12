import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../services/api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onExpired = () => { setToken(null); setUser(null); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.token); setUser(r.user); return r.user;
  }, []);
  const register = useCallback(async (data) => {
    const r = await api.post('/auth/register', data);
    setToken(r.token); setUser(r.user); return r.user;
  }, []);
  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null); setUser(null);
  }, []);
  const can = useCallback((...perms) => !!user && (perms.length === 0 || perms.some((p) => user.permissions.includes(p))), [user]);

  const value = useMemo(() => ({ user, setUser, loading, login, register, logout, can }), [user, loading, login, register, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
