'use strict';
/**
 * auth — sign in, current user, sign out.
 *   POST /api/auth/login   { email, password } → { token (JWT), user }
 *   GET  /api/auth/me      → { user }
 *   POST /api/auth/logout
 * Passwords are fixed (admins: ADMIN_EMAIL / ADMIN_PASSWORD; promoters: their fixed logins), so
 * there is no change-password route.
 */
module.exports = function register(G) {
  const { S, R } = G;
  const fails = new Map(); // email -> { first, count }  (slows down password guessing)
  const WINDOW = 15 * 60 * 1000;

  const readLogin = (body) => ({
    email: G.str(body.email, { field: 'Email', required: true, max: 120 }).toLowerCase(),
    password: G.str(body.password, { field: 'Password', required: true, max: 72 }),
  });
  const tooMany = (email) => { const f = fails.get(email); return f && Date.now() - f.first < WINDOW && f.count >= 10; };
  const failed = (email) => {
    const f = fails.get(email);
    if (!f || Date.now() - f.first >= WINDOW) fails.set(email, { first: Date.now(), count: 1 }); else f.count++;
    if (fails.size > 10000) fails.clear();
    return new G.LocalError(401, 'Incorrect email or password');
  };

  /**
   * Sign-in runs in three steps so the slow password check (bcrypt) does not hold up other requests:
   *   1. find the user (in the request queue)   2. check the password (outside)   3. finish (in the queue)
   */
  G.login = async (body, ip) => {
    const { email, password } = readLogin(body || {});
    if (tooMany(email)) throw new G.LocalError(429, 'Too many failed attempts. Try again in a few minutes.');
    const found = await G.run({ fn: () => { const u = S.users.find((x) => G.ieq(x.email, email)); return u ? { id: u.id, hash: u.password_hash } : null; } }, { ip });
    const ok = found ? await G.checkPassword(password, found.hash) : (await G.checkPassword(password, await G.dummyHash()), false);
    if (!ok) throw failed(email);
    const newHash = G.needsRehash(found.hash) ? await G.hashPassword(password) : null; // upgrade older hashes to bcrypt
    return G.run({ write: true, fn: () => {
      const u = G.byId('users', found.id);
      if (!u || u.password_hash !== found.hash) throw failed(email); // changed in the meantime
      if (u.status !== 'active') throw G.forbidden('Your account is inactive. Please contact your administrator.');
      fails.delete(email);
      if (newHash) u.password_hash = newHash;
      u.last_login_at = G.now();
      G.audit(u, 'login', 'user', u.user_code);
      return { token: G.tokenFor(u), user: G.publicUser(u) };
    } }, { ip });
  };

  R('GET', '/auth/me', 'any', ({ user }) => ({ user: G.publicUser(user) }));

  // Passwords are fixed: there is no change-password route.

  R('POST', '/auth/logout', 'any', ({ user }) => { G.audit(user, 'logout', 'user', user.user_code); return { ok: true }; }, { write: true });
};
