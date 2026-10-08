/* Signed-in user. login() / logout() and a guard for protected routes. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { api, session } from '../services/api';
import { toast } from '../components/Toasts';

const AuthContext = createContext(null);
export const homeFor = (u) => (u && u.role === 'admin' ? '/admin' : '/app');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => session.user());
  const navigate = useNavigate();

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api('/auth/login', { method: 'POST', body: { email, password } });
    session.set({ token, user: u });
    setUser(u);
    return u;
  }, []);
  const logout = useCallback(() => {
    api('/auth/logout', { method: 'POST', quiet: true, ignore401: true }).catch(() => {});
    session.clear();
    setUser(null);
    navigate('/', { replace: true });
  }, [navigate]);
  /** Check the saved token with the server and refresh the user details. */
  const refresh = useCallback(async () => {
    const s = session.get();
    if (!s || !s.token) { setUser(null); return null; }
    const { user: u } = await api('/auth/me', { quiet: true });
    session.set({ ...s, user: u });
    setUser(u);
    return u;
  }, []);

  useEffect(() => {
    const onUnauth = () => {
      setUser(null);
      toast('Your session has ended. Please sign in again.', 'warn');
      const next = window.location.pathname + window.location.search;
      setTimeout(() => navigate('/?next=' + encodeURIComponent(next), { replace: true }), 600);
    };
    window.addEventListener('gims:unauthorized', onUnauth);
    return () => window.removeEventListener('gims:unauthorized', onUnauth);
  }, [navigate]);

  const value = useMemo(() => ({ user, login, logout, refresh }), [user, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Only signed-in users with this role; others go to the sign-in page. */
export function ProtectedRoute({ role, children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user || !session.token()) return <Navigate to={'/?next=' + encodeURIComponent(loc.pathname + loc.search)} replace />;
  if (role && user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return children;
}
