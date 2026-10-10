'use strict';
/**
 * Business-logic core.
 *
 * The controllers (src/controllers/*.controller.js) hold the business rules of the Gift Inventory
 * system: shops, gifts, stock allocation, sales with proof photos, reports, imports, backups.
 * They work on an in-memory working copy of the data (S) that is loaded from MongoDB and written
 * back to MongoDB after every successful change (see services/store.js).
 *
 *   MongoDB is the single source of truth:
 *     - every request first checks the data revision stored in MongoDB and reloads when another
 *       server instance (or a manual change) wrote data;
 *     - a write request is only answered after its changes were saved in MongoDB;
 *     - when a save fails, the working copy is thrown away and reloaded from MongoDB.
 *
 * Requests run one at a time (a queue), so stock checks and stock updates never interleave.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const config = require('../config/env');
const Analytics = require('../shared/analytics');
const ImportRules = require('../shared/import-rules');
const PromoterMatch = require('../shared/promoter-match');
const DOS = require('../shared/dos-calc');
const ReportDefs = require('../shared/report-defs');

const G = {};
module.exports = G;
G.Analytics = Analytics; G.ImportRules = ImportRules; G.PromoterMatch = PromoterMatch; G.DOS = DOS; G.ReportDefs = ReportDefs;

/* ------------------------------ Errors ------------------------------ */
class AppError extends Error { constructor(status, msg, details) { super(msg); this.status = status; this.details = details; } }
G.LocalError = AppError; // name kept for the controllers
G.AppError = AppError;
G.bad = (m, d) => new AppError(400, m, d);
G.notFound = (w = 'Record') => new AppError(404, `${w} not found`);
G.forbidden = (m = 'You do not have permission to do this') => new AppError(403, m);
G.conflict = (m, d) => new AppError(409, m, d);
G.unauth = (m = 'Please sign in') => new AppError(401, m);

/* ------------------------------ State ------------------------------ */
G.COLL = ['users', 'cities', 'markets', 'shops', 'gifts', 'inv', 'txns', 'moves', 'audit', 'models', 'brands', 'sessions'];
const S = {}; // working copy of the database (plain objects); the same object for the process lifetime
const IX = {}; // collection -> Map(id -> row)
G.S = S; G.IX = IX;
G.emptyState = () => ({ v: 1, seq: {}, flags: {}, settings: { sales_mode: 'submitted' }, ...Object.fromEntries(G.COLL.map((c) => [c, []])) });
G.reindex = () => { for (const c of G.COLL) { if (!Array.isArray(S[c])) S[c] = []; IX[c] = new Map(S[c].map((r) => [r.id, r])); } };
/** Replace the working copy in place (keeps references held by the controllers valid). */
G.setState = (obj) => {
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, G.emptyState(), obj);
  if (!S.settings) S.settings = { sales_mode: 'submitted' };
  if (!S.flags) S.flags = {};
  if (!S.seq) S.seq = {};
  S.sessions = []; // sign-in is stateless (JWT); nothing is stored per session
  G.reindex();
};
G.setState({});
G.byId = (c, id) => IX[c].get(Number(id));
G.nextSeq = (name) => { S.seq[name] = (S.seq[name] || 0) + 1; return S.seq[name]; };
G.insert = (c, row) => { row.id = G.nextSeq('id_' + c); S[c].push(row); IX[c].set(row.id, row); return row; };
G.remove = (c, row) => { const i = S[c].indexOf(row); if (i >= 0) S[c].splice(i, 1); IX[c].delete(row.id); };
const pad = (n, w) => String(n).padStart(w, '0');
G.pad = pad;
G.codes = {
  shop: () => `SHP-${pad(G.nextSeq('shop'), 4)}`, gift: () => `GFT-${pad(G.nextSeq('gift'), 3)}`, brand: () => `BR${pad(G.nextSeq('brand'), 3)}`,
  txn: () => `TXN-${pad(G.nextSeq('txn'), 7)}`, promoter: () => `PRM-${pad(G.nextSeq('promoter'), 3)}`, admin: () => `ADM-${pad(G.nextSeq('admin'), 3)}`,
};
/** Next free code from a sequence, skipping codes already used (custom IDs from imports). */
G.freeCode = (kind, exists) => { let c; do c = G.codes[kind](); while (exists(c)); return c; };

/* ------------------------------ Dates ------------------------------ */
/* Timestamps are stored as UTC 'YYYY-MM-DD HH:MM:SS'. "Today", days and months use the business time
   zone (TZ, default Asia/Karachi), which server.js sets for the whole process. */
G.ts = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);
G.now = () => G.ts();
G.toDate = (s) => new Date(s.replace(' ', 'T') + 'Z');
G.localDay = (s) => { const d = G.toDate(s); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; };
G.localMonth = (s) => G.localDay(s).slice(0, 7);
G.localTime = (s) => { const d = G.toDate(s); return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`; };
G.localStamp = (s) => (s ? `${G.localDay(s)} ${G.localTime(s)}` : '');
G.dayBound = (d, end) => {
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw G.bad('Dates must be in YYYY-MM-DD format');
  return G.ts(new Date(`${d}T${end ? '23:59:59' : '00:00:00'}`));
};
G.today = () => G.localDay(G.now());

/* ------------------------------ Validation ------------------------------ */
G.str = (v, { field, required = false, max = 200, min = 0, pattern, patternMsg } = {}) => {
  if (v === undefined || v === null) v = '';
  if (typeof v === 'object') throw G.bad(`${field} is invalid`);
  v = String(v).trim();
  if (!v) { if (required) throw G.bad(`${field} is required`); return null; }
  if (v.length < min) throw G.bad(`${field} must be at least ${min} characters`);
  if (v.length > max) throw G.bad(`${field} must be at most ${max} characters`);
  if (pattern && !pattern.test(v)) throw G.bad(patternMsg || `${field} format is invalid`);
  return v;
};
G.int = (v, { field, required = true, min = Number.MIN_SAFE_INTEGER, max = 10_000_000, msg } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw G.bad(msg || `${field} is required`); return null; }
  const n = typeof v === 'object' ? NaN : Number(v);
  if (!Number.isInteger(n)) throw G.bad(`${field} must be a whole number`);
  if (n < min) throw G.bad(msg || `${field} must be at least ${min}`);
  if (n > max) throw G.bad(`${field} must be at most ${max}`);
  return n;
};
G.oneOf = (v, list, { field, required = false, dflt } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw G.bad(`${field} is required`); return dflt ?? null; }
  if (!list.includes(v)) throw G.bad(`${field} must be one of: ${list.join(', ')}`);
  return v;
};
G.EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
G.PHONE_RE = /^[+0-9][0-9\s-]{6,19}$/;
G.password = (v, field = 'Password') => {
  v = G.str(v, { field, required: true, min: 8, max: 72 });
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) throw G.bad(`${field} must contain letters and numbers`);
  return v;
};
/** Shop ID typed by an admin: 2–20 letters/numbers/dashes with at least one letter (e.g. PK413451, SHP-0008). */
G.shopCodeOf = (v, required) => {
  const c = G.str(v, { field: 'Shop ID', required, max: 20 });
  if (!c) return null;
  const up = c.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(up) || !/[A-Z]/.test(up)) throw G.bad('Shop ID must be 2–20 letters, numbers or dashes and contain at least one letter (e.g. PK413451)');
  return up;
};
/**
 * Find a shop from a scanned QR / typed Shop ID. Accepts the exact ID (PK413451), old style
 * numbers (SHP-1 → SHP-0001) and just the digits when they match one shop (413451).
 */
G.resolveShopCode = (raw) => {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  let shop = S.shops.find((x) => G.ieq(x.shop_id, s));
  const m = s.match(/^SHP-?(\d+)$/);
  if (!shop && m) shop = S.shops.find((x) => G.ieq(x.shop_id, `SHP-${m[1].padStart(4, '0')}`));
  if (!shop && /^\d+$/.test(s)) {
    const n = s.replace(/^0+/, '');
    const hits = S.shops.filter((x) => String(x.shop_id).replace(/\D/g, '').replace(/^0+/, '') === n);
    if (hits.length === 1) shop = hits[0];
  }
  return shop || null;
};
G.ieq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
G.like = (q) => { const s = String(q || '').trim().toLowerCase(); return s ? (...vals) => vals.some((v) => String(v ?? '').toLowerCase().includes(s)) : null; };
G.idList = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/* ------------------------------ Passwords (bcrypt) ------------------------------ */
/*
 * New and changed passwords are stored as bcrypt hashes (cost BCRYPT_ROUNDS, default 12). Plain-text
 * passwords are never stored. Hashes made by the earlier single-file app still sign in:
 *   pbkdf2$<rounds>$<salt>$<hex>   PBKDF2-HMAC-SHA256 (also used by the fixed promoter logins)
 *   <salt>$<hex>                   salted SHA-256 × 2000 (oldest files)
 * and are upgraded to bcrypt at the next successful sign-in.
 */
G.randHex = (n) => crypto.randomBytes(n).toString('hex');
G.sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const sameText = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const legacyHash = (pwd, salt) => { let x = salt + pwd; for (let i = 0; i < 2000; i++) x = G.sha256(x); return x; };
const pbkdf2 = (pwd, salt, rounds) => new Promise((res, rej) => crypto.pbkdf2(String(pwd), Buffer.from(salt, 'utf8'), rounds, 32, 'sha256', (e, k) => (e ? rej(e) : res(k.toString('hex')))));
G.hashPassword = (pwd) => bcrypt.hash(String(pwd), config.BCRYPT_ROUNDS);
G.checkPassword = async (pwd, stored) => {
  const h = String(stored || '');
  if (/^\$2[aby]\$\d\d\$/.test(h)) return bcrypt.compare(String(pwd), h);
  const parts = h.split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) { const rounds = Number(parts[1]); return rounds > 0 && rounds <= 5_000_000 && sameText(await pbkdf2(pwd, parts[2], rounds), parts[3]); }
  if (parts.length === 2 && parts[0] && parts[1]) return sameText(legacyHash(String(pwd), parts[0]), parts[1]);
  return false;
};
G.needsRehash = (stored) => !/^\$2[aby]\$\d\d\$/.test(String(stored || ''));
/** A hash of a random value: an unknown email takes as long to check as a known one. */
let dummy = null;
G.dummyHash = async () => (dummy = dummy || G.hashPassword(G.randHex(16)));

/* ------------------------------ Audit ------------------------------ */
G.audit = (user, action, entity, entityId, details) => {
  G.insert('audit', {
    user_id: user ? user.id : null, user_name: user ? user.name : null, role: user ? user.role : null,
    action, entity: entity || null, entity_id: entityId != null ? String(entityId) : null,
    details: details ? JSON.stringify(details) : null, ip: G.requestIp || 'server', created_at: G.now(),
  });
  if (S.audit.length > config.AUDIT_MAX) { S.audit.splice(0, S.audit.length - config.AUDIT_MAX); IX.audit = new Map(S.audit.map((r) => [r.id, r])); }
};

/* ------------------------------ Sign-in tokens (JWT) ------------------------------ */
G.publicUser = (u) => ({ id: u.id, user_code: u.user_code, name: u.name, email: u.email, phone: u.phone, role: u.role });
/*
 * JWT (HS256) signed with JWT_SECRET. Claims: sub = user id, role, tv = the user's token_version.
 * Deactivating a user, changing the role or restoring a backup raises token_version, which ends all
 * of that user's sign-ins at once.
 */
G.tokenFor = (u) => jwt.sign({ sub: String(u.id), role: u.role, tv: u.token_version || 0 }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: config.JWT_EXPIRES_IN, issuer: 'gift-inventory' });
/** Verify signature + expiry only (no database access). */
G.verifyToken = (token) => {
  if (!token) throw G.unauth();
  try { return jwt.verify(String(token), config.JWT_SECRET, { algorithms: ['HS256'], issuer: 'gift-inventory' }); }
  catch (_) { throw G.unauth('Your session is no longer valid. Please sign in again.'); }
};
/** Full check against the current data: the user exists, is active and the token is still current. */
G.authenticate = (token) => {
  const claims = typeof token === 'object' && token ? token : G.verifyToken(token);
  const u = G.byId('users', claims.sub);
  if (!u || u.status !== 'active' || Number(claims.tv) !== Number(u.token_version || 0)) throw G.unauth('Your session is no longer valid. Please sign in again.');
  return u;
};
G.endSession = () => {}; // stateless: the browser deletes its token

/* ------------------------------ Paging / sorting / CSV ------------------------------ */
G.page = (q, rows, { dflt = 25, max = 200 } = {}) => {
  const p = Math.max(1, parseInt(q.page, 10) || 1);
  const size = Math.min(max, Math.max(1, parseInt(q.pageSize, 10) || dflt));
  return { rows: rows.slice((p - 1) * size, p * size), total: rows.length, page: p, pageSize: size };
};
G.sortBy = (rows, key, dir) => {
  const m = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
    return String(x ?? '').localeCompare(String(y ?? '')) * m;
  });
};
G.csv = (filename, columns, rows) => {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    const s = String(v);
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))].join('\r\n');
  return { __file: new Blob([text], { type: 'text/csv;charset=utf-8' }), filename };
};
G.sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
G.groupBy = (rows, keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
/** {columns, rows, totals} or a CSV file when ?format=csv */
G.reportOut = (query, name, columns, rows) => {
  const totals = {};
  for (const c of columns) if (c.num && c.sum !== false) totals[c.key] = G.sum(rows, c.key);
  if (query.format === 'csv') return G.csv(`${name}.csv`, columns.map((c) => ({ label: c.label, key: c.key })), rows);
  return { columns, rows, totals };
};

/* ------------------------------ Joined views ------------------------------ */
G.invTotalsByShop = () => {
  const m = new Map();
  for (const i of S.inv) {
    const t = m.get(i.shop_id) || { allocated: 0, distributed: 0, pending: 0 };
    t.allocated += i.allocated_quantity; t.distributed += i.distributed_quantity; t.pending += i.pending_quantity;
    m.set(i.shop_id, t);
  }
  return m;
};
/** Ids of the promoters assigned to a shop. Works with one promoter (promoter_id) and with several (promoter_ids). */
G.shopPromoterIds = (s) => (Array.isArray(s.promoter_ids) && s.promoter_ids.length ? [...new Set(s.promoter_ids.map(Number))] : s.promoter_id ? [Number(s.promoter_id)] : []);
G.shopHasPromoter = (s, userId) => G.shopPromoterIds(s).includes(Number(userId));
/** The promoters assigned to a shop (user records that still exist). */
G.shopPromoters = (s) => G.shopPromoterIds(s).map((id) => G.byId('users', id)).filter(Boolean);
G.shopView = (s, totals) => {
  const c = G.byId('cities', s.city_id) || {}; const m = G.byId('markets', s.market_id) || {}; const ps = G.shopPromoters(s);
  const t = (totals || G.invTotalsByShop()).get(s.id) || { allocated: 0, distributed: 0, pending: 0 };
  // promoter_id / promoter_name / promoter_code keep working for screens that show one value; with two promoters the names are joined ("A, B")
  return { ...s, city_name: c.city_name, market_name: m.market_name,
    promoter_id: ps.length ? ps[0].id : null, promoter_ids: ps.map((u) => u.id),
    promoter_name: ps.length ? ps.map((u) => u.name).join(', ') : null, promoter_code: ps.length ? ps.map((u) => u.user_code).join(', ') : null,
    promoters: ps.map((u) => ({ id: u.id, name: u.name, user_code: u.user_code, status: u.status })),
    allocated: t.allocated, distributed: t.distributed, pending: t.pending, remaining: t.allocated - t.distributed };
};
G.findShop = (idOrCode) => {
  const s = /^\d+$/.test(String(idOrCode)) ? G.byId('shops', idOrCode) : S.shops.find((x) => G.ieq(x.shop_id, idOrCode));
  if (!s) throw G.notFound('Shop');
  return s;
};
G.giftView = (g) => {
  let allocated = 0, distributed = 0, pending = 0, shops = 0;
  for (const i of S.inv) if (i.gift_id === g.id && i.allocated_quantity > 0) { allocated += i.allocated_quantity; distributed += i.distributed_quantity; pending += i.pending_quantity; shops++; }
  return { ...g, allocated, distributed, pending, unallocated: g.total_quantity - allocated, remaining_in_shops: allocated - distributed, shop_count: shops };
};
G.findGift = (idOrCode) => {
  const g = /^\d+$/.test(String(idOrCode)) ? G.byId('gifts', idOrCode) : S.gifts.find((x) => G.ieq(x.gift_id, idOrCode));
  if (!g) throw G.notFound('Gift');
  return g;
};
G.invView = (i) => {
  const s = G.byId('shops', i.shop_id); const g = G.byId('gifts', i.gift_id);
  const c = G.byId('cities', s.city_id) || {}; const m = G.byId('markets', s.market_id) || {}; const ps = G.shopPromoters(s);
  return { id: i.id, shop_pk: s.id, shop_id: s.shop_id, shop_name: s.shop_name, shop_status: s.status, city_id: s.city_id, market_id: s.market_id, promoter_id: ps.length ? ps[0].id : null, promoter_ids: ps.map((u) => u.id),
    city_name: c.city_name, market_name: m.market_name, promoter_name: ps.length ? ps.map((u) => u.name).join(', ') : null,
    gift_pk: g.id, gift_id: g.gift_id, gift_name: g.gift_name, unit: g.unit, gift_status: g.status,
    allocated: i.allocated_quantity, distributed: i.distributed_quantity, pending: i.pending_quantity,
    remaining: i.allocated_quantity - i.distributed_quantity, available: i.allocated_quantity - i.distributed_quantity - i.pending_quantity, updated_at: i.updated_at };
};
/** Brand of a transaction: stored at submission; older records fall back to the model's brand. */
G.txnBrand = (t, md) => (t.brand_id ? G.byId('brands', t.brand_id) : md && md.brand_id ? G.byId('brands', md.brand_id) : null) || null;
G.txnView = (t) => {
  const s = G.byId('shops', t.shop_id); const g = G.byId('gifts', t.gift_id); const u = G.byId('users', t.promoter_id); const rv = t.reviewed_by ? G.byId('users', t.reviewed_by) : null;
  const c = G.byId('cities', s.city_id) || {}; const m = G.byId('markets', s.market_id) || {}; const md = t.model_id ? G.byId('models', t.model_id) : null; const br = G.txnBrand(t, md);
  const approved = t.status === 'approved';
  return { id: t.id, transaction_id: t.transaction_id, status: t.status, status_label: Analytics.statusLabel(t.status),
    quantity: t.quantity, mobile_qty: t.mobile_qty ?? null, rejection_reason: t.rejection_reason, remarks: t.remarks,
    created_at: t.created_at, reviewed_at: t.reviewed_at, review_started_at: t.review_started_at || null, latitude: t.latitude, longitude: t.longitude,
    has_photo: !!t.photo_path, has_mobile_photo: !!t.mobile_photo_path,
    shop_pk: s.id, shop_id: s.shop_id, shop_name: s.shop_name, city_id: s.city_id, market_id: s.market_id, city_name: c.city_name, market_name: m.market_name, address: s.address,
    gift_pk: g.id, gift_id: g.gift_id, gift_name: g.gift_name, unit: g.unit,
    promoter_pk: u.id, promoter_name: u.name, promoter_code: u.user_code,
    brand_pk: br ? br.id : null, brand_code: br ? br.brand_code : null, brand_name: br ? br.brand_name : null,
    model_pk: md ? md.id : null, model_name: md ? md.model_name : null, item_code: md ? md.item_code : null,
    reviewed_by_name: rv ? rv.name : null, approved_at: approved ? t.reviewed_at : null, approved_by_name: approved && rv ? rv.name : null };
};
G.invRow = (shopId, giftId) => S.inv.find((i) => i.shop_id === shopId && i.gift_id === giftId);
G.getOrCreateInv = (shopId, giftId) => G.invRow(shopId, giftId) ||
  G.insert('inv', { shop_id: shopId, gift_id: giftId, allocated_quantity: 0, distributed_quantity: 0, pending_quantity: 0, created_at: G.now(), updated_at: G.now() });
G.giftAllocated = (gid) => S.inv.reduce((a, i) => a + (i.gift_id === gid ? i.allocated_quantity : 0), 0);
G.assertInv = (i) => {
  if (i.allocated_quantity < 0 || i.distributed_quantity < 0 || i.pending_quantity < 0 || i.distributed_quantity + i.pending_quantity > i.allocated_quantity) {
    throw G.conflict('This change conflicts with the stock rules. Please refresh and try again.');
  }
};
/** Which transactions count as mobile sales (no approval process: every submitted sale counts). */
G.salesMode = () => (S.settings && S.settings.sales_mode === 'approved' ? 'approved' : 'submitted');
G.isCounted = (t) => Analytics.counted(t, G.salesMode());

/* ------------------------------ Files ------------------------------ */
G.files = null; // set by the store (photos and images live in MongoDB, collection storedfiles)
G.dataUrlToBlob = async (u) => {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(u || ''));
  if (!m) throw G.bad('Invalid image data');
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return new Blob([buf], { type: m[1] || 'application/octet-stream' });
};
G.blobToDataUrl = async (b) => `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(await b.arrayBuffer()).toString('base64')}`;
G.readImage = async (file, label = 'A photo') => {
  if (!file || typeof file === 'string' || !file.size) throw G.bad(`${label} is required`);
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw G.bad(`${label}: only JPG, PNG or WEBP images are allowed`);
  if (file.size > config.MAX_PHOTO_MB * 1024 * 1024) throw G.bad(`${label} is too large. Maximum size is ${config.MAX_PHOTO_MB} MB.`);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isWebp = String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
  if (!isJpg && !isPng && !isWebp) throw G.bad(`${label} is not a valid image`);
  return file;
};
G.qrData = (text, width = 360) => QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width });

/* ------------------------------ Route table ------------------------------ */
/**
 * Controllers declare their endpoints with
 *   G.R(method, '/shops/:id', role, handler({ params, query, body, form, user }), { write })
 *   role: null = public, 'any' = any signed-in user, 'admin' / 'promoter' = only that role.
 * routes/index.js mounts every entry on the Express router with authentication and role checks.
 */
G.routes = [];
G.R = (method, path, role, fn, opts = {}) => { G.routes.push({ method, path, role, fn, write: !!opts.write, ...opts }); };

/* ------------------------------ Request execution ------------------------------ */
let store = null;
G.useStore = (s) => { store = s; G.files = s.files; };
/** Save the working copy to MongoDB (only the documents that changed; { replace: true } = full replace). */
G.persist = async (opts) => { await store.save(S, opts); };

let queue = Promise.resolve();
/** Run fn exclusively (one request at a time). */
G.exclusive = (fn) => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

/**
 * Execute one route handler.
 *   ctx = { params, query, body, form, claims, ip }
 * Reads see the latest data in MongoDB; writes are saved to MongoDB before the answer is sent.
 */
G.run = (route, ctx) => G.exclusive(async () => {
  // a write first takes the write lock shared by all server instances, then reads the latest data
  const lock = route.write ? await store.lock().catch((e) => { throw new AppError(e.status || 503, e.message); }) : null;
  try {
    await store.ensureFresh(!!lock);
    return await runRoute(route, ctx);
  } finally { if (lock) await store.unlock(lock); }
});

async function runRoute(route, ctx) {
  G.requestIp = ctx.ip || null;
  try {
    let user = null;
    if (route.role) {
      user = G.authenticate(ctx.claims);
      if (route.role !== 'any' && user.role !== route.role) throw G.forbidden('You do not have access to this area');
    }
    if (route.method === 'PUT' && ctx.body && ctx.body.expected_updated_at !== undefined) G.checkNotChanged(route.path, ctx.params || {}, ctx.body.expected_updated_at);
    const before = route.write ? JSON.stringify(S) : null;
    const writes = store.writeCount;
    try {
      const out = await route.fn({ params: ctx.params || {}, query: ctx.query || {}, body: ctx.body || {}, form: ctx.form || null, user, token: ctx.token });
      if (route.write) {
        await G.persist();
        G.onWrite && G.onWrite(ctx);
      }
      return out;
    } catch (e) {
      if (before && !(e instanceof AppError && e.status === 401)) {
        G.setState(JSON.parse(before)); // roll back partial changes in the working copy …
        // … and when something reached MongoDB already (or the error was unexpected), read MongoDB again
        // before the next request: it is the source of truth
        if (store.writeCount !== writes || !(e instanceof AppError)) store.invalidate();
      }
      throw e;
    }
  } finally { G.requestIp = null; }
}

/**
 * Edit conflicts between devices: an edit form sends the record's updated_at as it was when the form
 * opened (expected_updated_at). When the record was changed on another device since then, the save is
 * refused with 409 instead of silently overwriting the other change.
 */
const EDITABLE = {
  '/shops/:id': (p) => G.findShop(p.id), '/gifts/:id': (p) => G.findGift(p.id), '/users/:id': (p) => G.byId('users', p.id),
  '/models/:id': (p) => G.byId('models', p.id), '/brands/:id': (p) => G.byId('brands', p.id),
};
G.checkNotChanged = (path, params, expected) => {
  const find = EDITABLE[path];
  if (!find || !expected) return;
  let row = null;
  try { row = find(params); } catch (_) { return; } // the handler reports "not found"
  if (row && row.updated_at && String(expected) !== String(row.updated_at)) {
    throw G.conflict('This record was changed on another device while you were editing. Close the form and open it again to see the latest data.', { updated_at: row.updated_at });
  }
};

/** Register all controllers (order = route matching order). */
G.loadControllers = () => {
  if (G.routes.length) return;
  for (const name of ['auth', 'shops', 'promoters', 'brands', 'models', 'gifts', 'inventory', 'transactions', 'sales', 'reports', 'imports', 'system']) {
    require(`../controllers/${name}.controller`)(G);
  }
};
