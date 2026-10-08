/* Sign-in page (same design as the original). Admins and promoters use the same sign-in. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { api, session } from '../services/api';
import { useAuth, homeFor } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pwd = useRef(null);

  useEffect(() => { document.title = 'Sign in · Gift Inventory'; document.body.className = ''; }, []);
  // Already signed in? Check the token and go straight in.
  useEffect(() => {
    const s = session.get();
    if (!s || !s.token) return;
    api('/auth/me', { quiet: true }).then(({ user }) => {
      session.set({ token: s.token, user });
      navigate(homeFor(user), { replace: true });
    }).catch(() => session.clear());
  }, [navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Please enter your email and password.'); return; }
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      const home = homeFor(user);
      navigate(next && next.startsWith(home) ? next : home, { replace: true });
    } catch (ex) {
      setError(ex.message);
      setBusy(false);
      if (pwd.current) pwd.current.select();
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-art">
        <div className="auth-maker">INFINIX</div>
        <div className="brand"><span className="logo-mark"><Icon name="gift" /></span>Gift Inventory &amp; Shop Sales</div>
        <h1>Every gift tracked from warehouse to shop counter.</h1>
        <p>Allocate promotional gifts shop by shop, capture photo-verified distribution in the field, and see remaining stock in real time.</p>
        <div className="flow">
          <span>Allocate to shop</span><span>Scan shop QR</span><span>Submit with photo</span><span>Stock deducted at once</span><span>Reports</span>
        </div>
      </section>
      <section className="auth-form">
        <form className="auth-card stack" id="login" noValidate onSubmit={submit}>
          <div className="row" style={{ gap: 10, marginBottom: 6 }}><span className="logo-mark"><Icon name="gift" /></span><b>Gift Inventory</b></div>
          <div>
            <h2>Sign in</h2>
            <div className="muted">Admins and shop promoters use the same sign-in.</div>
          </div>
          {error && <div className="callout bad" id="err" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" autoComplete="username" inputMode="email" required style={{ height: 42 }} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required style={{ height: 42 }} ref={pwd} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn primary lg block" id="submit" type="submit" disabled={busy}>{busy ? <><span className="spinner" /><span>Signing in…</span></> : 'Sign in'}</button>
          <div className="muted small" style={{ textAlign: 'center' }}>Forgot your password? Ask your administrator.</div>
        </form>
        <div className="auth-credit">Created by <b>Ali Raza</b> · Infinix DCR Manager</div>
      </section>
    </div>
  );
}
