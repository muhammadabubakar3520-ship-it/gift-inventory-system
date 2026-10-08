'use strict';
/* promoters.js — users (promoters and admins), promoter performance. */
module.exports = function register(G) {
  const { S, R } = G;
  const A = () => G.Analytics;

  function userView(u) {
    const shops = S.shops.filter((s) => s.promoter_id === u.id);
    const tx = S.txns.filter((t) => t.promoter_id === u.id);
    const sold = tx.filter(G.isCounted);
    const open = tx.filter((t) => A().isOpen(t.status));
    return { id: u.id, user_code: u.user_code, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status, last_login_at: u.last_login_at, created_at: u.created_at, updated_at: u.updated_at,
      shops_assigned: shops.length, active_shops: shops.filter((s) => s.status === 'active').length, transactions: tx.length,
      mobile_units: G.sum(sold, 'mobile_qty'), gifts_given: G.sum(sold, 'quantity'),
      approved_qty: G.sum(tx.filter((t) => t.status === 'approved'), 'quantity'), pending_qty: G.sum(open, 'quantity'),
      pending_count: open.length, rejected_count: tx.filter((t) => t.status === 'rejected').length,
      last_txn_at: tx.reduce((m, t) => (t.created_at > (m || '') ? t.created_at : m), null) };
  }
  G.userView = userView;
  const findUser = (id) => { const u = G.byId('users', id); if (!u) throw G.notFound('User'); return u; };
  const activeAdmins = () => S.users.filter((u) => u.role === 'admin' && u.status === 'active').length;

  R('GET', '/users', 'admin', ({ query }) => {
    const s = G.like(query.search);
    return S.users.filter((u) => (!query.role || u.role === query.role) && (!query.status || u.status === query.status) && (!s || s(u.name, u.email, u.phone, u.user_code)))
      .map(userView).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  });
  R('GET', '/users/:id', 'admin', ({ params }) => {
    const u = findUser(params.id);
    const shops = S.shops.filter((s) => s.promoter_id === u.id).map((s) => G.shopView(s)).map((s) => ({ id: s.id, shop_id: s.shop_id, shop_name: s.shop_name, status: s.status, city_name: s.city_name, market_name: s.market_name }));
    return { user: userView(u), shops };
  });
  function readUserBody(b, isNew) {
    const out = {
      name: G.str(b.name, { field: 'Name', required: true, max: 100 }),
      email: G.str(b.email, { field: 'Email', required: true, max: 120, pattern: G.EMAIL_RE, patternMsg: 'Email address is invalid' }).toLowerCase(),
      phone: G.str(b.phone, { field: 'Phone', max: 20, pattern: G.PHONE_RE, patternMsg: 'Phone number is invalid' }),
      role: G.oneOf(b.role, ['admin', 'promoter'], { field: 'Role', dflt: 'promoter' }), status: G.oneOf(b.status, ['active', 'inactive'], { field: 'Status', dflt: 'active' }),
    };
    if (isNew) out.password = G.password(b.password);
    return out;
  }
  G.createUser = async (b, actor, via) => {
    const u = G.insert('users', { user_code: b.user_code || (b.role === 'admin' ? G.codes.admin() : G.freeCode('promoter', (c) => S.users.some((x) => x.user_code === c))),
      name: b.name, email: b.email, phone: b.phone || null, password_hash: b.password_hash || await G.hashPassword(b.password),
      role: b.role, status: b.status || 'active', token_version: 0, last_login_at: null, created_at: G.now(), updated_at: G.now() });
    G.audit(actor, 'user_created', 'user', u.user_code, { name: u.name, email: u.email, role: u.role, via });
    return u;
  };
  R('POST', '/users', 'admin', async ({ body, user }) => {
    const b = readUserBody(body, true);
    if (S.users.some((u) => G.ieq(u.email, b.email))) throw G.conflict('A user with this email already exists');
    return userView(await G.createUser(b, user));
  }, { write: true });
  R('PUT', '/users/:id', 'admin', ({ params, body, user }) => {
    const u = findUser(params.id);
    const b = readUserBody(body, false);
    if (S.users.some((x) => x.id !== u.id && G.ieq(x.email, b.email))) throw G.conflict('A user with this email already exists');
    if (u.role !== b.role && S.shops.some((s) => s.promoter_id === u.id)) throw G.conflict("Unassign this promoter's shops before changing the role");
    if (u.role === 'admin' && u.status === 'active' && (b.role !== 'admin' || b.status !== 'active') && activeAdmins() <= 1) throw G.conflict('At least one active admin is required');
    if (u.id === user.id && b.status !== 'active') throw G.bad('You cannot deactivate your own account');
    if (b.status !== u.status || b.role !== u.role) u.token_version++;
    Object.assign(u, b, { updated_at: G.now() });
    G.audit(user, 'user_updated', 'user', u.user_code, b);
    return userView(u);
  }, { write: true });
  R('PATCH', '/users/:id/status', 'admin', ({ params, body, user }) => {
    const u = findUser(params.id);
    const status = G.oneOf(body.status, ['active', 'inactive'], { field: 'Status', required: true });
    if (u.id === user.id) throw G.bad('You cannot change your own status');
    if (u.role === 'admin' && status === 'inactive' && activeAdmins() <= 1) throw G.conflict('At least one active admin is required');
    u.status = status; u.token_version++; u.updated_at = G.now();
    S.sessions = S.sessions.filter((x) => x.user_id !== u.id);
    G.audit(user, status === 'active' ? 'user_activated' : 'user_deactivated', 'user', u.user_code);
    return { ok: true };
  }, { write: true });
  // Passwords are fixed (seed/promoter-logins.json for promoters): there is no password change route.

  /* ---------- performance ---------- */
  /** Counted sales rows in a date range (+ filters). */
  G.salesRows = (q, extra) => {
    const from = G.dayBound(q.from, false); const to = G.dayBound(q.to, true);
    const rows = S.txns.filter((t) => G.isCounted(t) && (!from || t.created_at >= from) && (!to || t.created_at <= to) && (!extra || extra(t))).map(G.txnView);
    return A().filter(rows, { ...q, status: '' });
  };
  function performanceRows(q) {
    const sold = G.salesRows(q);
    const from = G.dayBound(q.from, false); const to = G.dayBound(q.to, true);
    const all = S.txns.filter((t) => (!from || t.created_at >= from) && (!to || t.created_at <= to));
    const by = new Map(A().byPromoter(sold).map((r) => [r.promoter_id, r]));
    return S.users.filter((u) => u.role === 'promoter' && (!q.promoter_id || u.id === Number(q.promoter_id))).map((u) => {
      const r = by.get(u.id) || { units: 0, gifts: 0, txns: 0, shops: 0, ratio: null };
      const mine = all.filter((t) => t.promoter_id === u.id);
      return { promoter_id: u.id, user_code: u.user_code, name: u.name, status: u.status, phone: u.phone,
        shops_assigned: S.shops.filter((s) => s.promoter_id === u.id && (!q.city_id || s.city_id === Number(q.city_id))).length,
        shops_sold: r.shops, mobile_units: r.units, gifts_given: r.gifts, ratio: r.ratio, transactions: r.txns,
        approved: mine.filter((t) => t.status === 'approved').length, open: mine.filter((t) => A().isOpen(t.status)).length, rejected: mine.filter((t) => t.status === 'rejected').length,
        last_activity: mine.reduce((m, t) => (t.created_at > (m || '') ? t.created_at : m), null) };
    }).sort((a, b) => b.mobile_units - a.mobile_units || b.gifts_given - a.gifts_given || a.name.localeCompare(b.name));
  }
  G.performanceRows = performanceRows;
  R('GET', '/promoters/performance', 'admin', ({ query }) => {
    const rows = performanceRows(query);
    return { rows, totals: { mobile_units: G.sum(rows, 'mobile_units'), gifts_given: G.sum(rows, 'gifts_given'), transactions: G.sum(rows, 'transactions'), shops_assigned: G.sum(rows, 'shops_assigned') },
      ratio: A().ratio(G.sum(rows, 'gifts_given'), G.sum(rows, 'mobile_units')), mode: G.salesMode() };
  });
  R('GET', '/promoters/:id/performance', 'admin', ({ params, query }) => {
    const u = findUser(params.id);
    if (u.role !== 'promoter') throw G.notFound('Promoter');
    const sold = G.salesRows(query, (t) => t.promoter_id === u.id);
    const assigned = S.shops.filter((s) => s.promoter_id === u.id).map((s) => G.shopView(s));
    const byShop = new Map(A().byShop(sold).map((r) => [r.shop_pk, r]));
    const shops = [...new Set([...assigned.map((s) => s.id), ...byShop.keys()])].map((id) => {
      const s = G.shopView(G.byId('shops', id)); const r = byShop.get(id) || { units: 0, gifts: 0, txns: 0, ratio: null };
      return { shop_pk: s.id, shop_id: s.shop_id, shop_name: s.shop_name, city_name: s.city_name, market_name: s.market_name, status: s.status, assigned: s.promoter_id === u.id, units: r.units, gifts: r.gifts, txns: r.txns, ratio: r.ratio };
    }).sort((a, b) => b.units - a.units || a.shop_name.localeCompare(b.shop_name));
    const recent = S.txns.filter((t) => t.promoter_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15).map(G.txnView);
    return { user: userView(u), summary: A().summary(sold), brands: A().brandTree(sold), models: A().byModel(sold), gifts: A().byGift(sold), shops,
      daily: A().series(sold, A().lastDays(30, G.today()), (t) => G.localDay(t.created_at)), recent, mode: G.salesMode() };
  });
};
