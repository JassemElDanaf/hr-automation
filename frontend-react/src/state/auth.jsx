import { createContext, useContext, useEffect, useState } from 'react';
import * as api from '../services/auth';
import { setAuthRole } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Keep the API-layer read-only gate in sync with the current role.
  useEffect(() => { setAuthRole(user?.role || null); }, [user]);

  // Restore session from a stored token on first load.
  useEffect(() => {
    const tok = api.getToken();
    if (!tok) { setLoading(false); return; }
    api.fetchMe(tok).then((u) => {
      if (!u) api.setToken('');   // stale/expired token
      setUser(u);
      setLoading(false);
    });
  }, []);

  async function login(email, password) {
    const { token, user } = await api.login(email, password);
    api.setToken(token);
    setUser(user);
    return user;
  }

  async function logout() {
    await api.logoutRequest();
    api.setToken('');
    setUser(null);
  }

  const role = user?.role || null;
  const value = {
    user, role, loading, login, logout,
    isAdmin: role === 'admin',
    isViewer: role === 'viewer',
    canWrite: role === 'admin' || role === 'recruiter',  // viewers are read-only
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
