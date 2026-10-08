'use strict';
/* system.js — settings, audit log, backup / restore / reset. */
module.exports = function register(G) {
  const { S, R } = G;

  /* ---------- settings ---------- */
  R('GET', '/settings', 'admin', () => ({ sales_mode: G.salesMode(), sales_modes: G.Analytics.SALES_MODES }));
  R('PUT', '/settings', 'admin', ({ body, user }) => {
    const mode = G.oneOf(body.sales_mode, ['submitted', 'approved'], { field: 'Sales recording', required: true });
    const before = G.salesMode();
    S.settings.sales_mode = mode;
    if (before !== mode) G.audit(user, 'settings_updated', 'settings', 'sales_mode', { from: before, to: mode });
    return { ok: true, sales_mode: mode };
  }, { write: true });

  /* ---------- audit ---------- */
  function filterAudit(q) {
    const s = G.like(q.search);
    const from = G.dayBound(q.from, false); const to = G.dayBound(q.to, true);
    return S.audit.filter((a) => (!s || s(a.action, a.entity_id, a.user_name, a.details)) && (!q.action || a.action === q.action || (q.action.endsWith('*') && a.action.startsWith(q.action.slice(0, -1)))) &&
      (!from || a.created_at >= from) && (!to || a.created_at <= to)).slice().reverse();
  }
  R('GET', '/audit', 'admin', ({ query }) => G.page(query, filterAudit(query), { dflt: 50 }));
  R('GET', '/audit/actions', 'admin', () => [...new Set(S.audit.map((a) => a.action))].sort());
  R('GET', '/audit/export.csv', 'admin', ({ query }) => G.csv('audit-log.csv', [
    { label: 'Date', value: (r) => G.localDay(r.created_at) }, { label: 'Time', value: (r) => G.localTime(r.created_at) }, { label: 'User', key: 'user_name' }, { label: 'Role', key: 'role' },
    { label: 'Action', key: 'action' }, { label: 'Entity', key: 'entity' }, { label: 'Reference', key: 'entity_id' }, { label: 'Details', key: 'details' },
  ], filterAudit(query)));

  /* ---------- central database: info / backup / restore ---------- */
  R('GET', '/system/info', 'admin', async () => {
    const files = await G.files.stats();
    let db = null;
    try { const st = await require('mongoose').connection.db.stats(); db = { name: st.db, data_bytes: st.dataSize, storage_bytes: st.storageSize, collections: st.collections }; } catch (_) { /* not allowed on some plans */ }
    return { shops: S.shops.length, gifts: S.gifts.length, users: S.users.length, brands: S.brands.length, models: S.models.length, transactions: S.txns.length,
      photos: files.count, photo_bytes: files.bytes, storage: 'MongoDB (central database)', database: db, db_bytes: db ? db.data_bytes + files.bytes : files.bytes };
  });
  /**
   * Full backup as one JSON file: the same format as the earlier single-file HTML app
   *   { app: 'gift-inventory', format: 2, exported_at, state: {...}, files: { key: data URL } }
   * so data can move between the HTML app and this central database. Password hashes stay hashes.
   */
  R('GET', '/system/backup', 'admin', async ({ user, query }) => {
    const files = {};
    if (query.photos !== 'no') {
      for (const k of await G.files.fileKeys()) { const b = await G.files.fileGet(k); if (b) files[k] = await G.blobToDataUrl(b); }
    }
    G.audit(user, 'backup_exported', 'system', null, { photos: Object.keys(files).length });
    await G.persist();
    const payload = JSON.stringify({ app: 'gift-inventory', format: 2, source: 'mongodb', exported_at: G.now(), state: { ...S, sessions: [] }, files });
    const d = new Date();
    return { __file: new Blob([payload], { type: 'application/json' }), filename: `gift-inventory-backup-${d.getFullYear()}-${G.pad(d.getMonth() + 1, 2)}-${G.pad(d.getDate(), 2)}.json` };
  });
  /**
   * Restore / move data in: REPLACES all data in MongoDB with the backup file (for example a backup
   * downloaded from the HTML app). Afterwards everyone signs in again; the admin from ADMIN_EMAIL /
   * ADMIN_PASSWORD can always sign in; other admins that still use the old starting password are
   * switched off.
   */
  R('POST', '/system/restore', 'admin', async ({ form }) => {
    const f = form && form.get('file');
    if (!f || typeof f === 'string') throw G.bad('Choose a backup file');
    let data;
    try { data = JSON.parse(await f.text()); } catch (_) { throw G.bad('This is not a valid backup file'); }
    if (!data || data.app !== 'gift-inventory' || !data.state || !Array.isArray(data.state.users)) throw G.bad('This is not a Gift Inventory backup file');
    const hasAdmin = data.state.users.some((u) => u.role === 'admin' && u.status === 'active');
    if (!hasAdmin && !G.envAdminConfigured()) throw G.bad('The backup has no active admin account');
    // check the photos before anything is changed
    const photos = [];
    for (const [k, v] of Object.entries(data.files || {})) {
      if (typeof v !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(v)) continue;
      photos.push([String(k).slice(0, 200), await G.dataUrlToBlob(v)]);
    }
    G.setState(data.state);
    for (const u of S.users) { u.email = String(u.email || '').toLowerCase(); u.token_version = Number(u.token_version || 0) + 1; } // all old sign-ins end
    G.migrate();
    await G.ensureEnvAdmin();
    for (const u of S.users.filter((x) => x.role === 'admin' && x.status === 'active' && !G.isEnvAdmin(x))) {
      if (await G.checkPassword('Admin@123', u.password_hash)) { u.status = 'inactive'; u.token_version++; } // the old well-known starting password
    }
    await G.persist({ replace: true }); // the data first (full replace), then the photos
    await G.files.filesClear();
    for (const [k, b] of photos) await G.files.fileSet(k, b);
    G.audit(null, 'backup_restored', 'system', null, { from: data.exported_at || null, source: data.source || 'html app', shops: S.shops.length, transactions: S.txns.length, photos: photos.length });
    return { ok: true, restored_from: data.exported_at || null, shops: S.shops.length, transactions: S.txns.length, users: S.users.length, photos: photos.length };
  }, { write: true });
  // There is no "reset database" route on the central database.
};
