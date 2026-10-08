'use strict';
/**
 * Starting data, upgrades of saved data and the start-up of the data layer.
 *
 * Starting data (src/seed/*.json) is the provided list of promoters (with their fixed logins), shops,
 * gifts, phone models and brands. It is loaded ONLY into an empty database. Upgrades never change
 * provided records; they only add what newer versions need (same rules as the earlier HTML app,
 * so a backup from the HTML app can be restored here).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');

const DIR = path.join(__dirname, '..', 'seed');
const readJson = (f) => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

/**
 * Fixed promoter logins (src/seed/promoter-logins.json): only one-way PBKDF2 hashes are kept in the
 * file, never the passwords. PROMOTER_LOGINS_FILE can point to another file (the automated tests use
 * test/fixtures/promoter-logins.test.json, whose rows give test passwords that are hashed here).
 */
const saltFor = (email) => crypto.createHash('sha256').update('gift-ims-login|' + String(email).toLowerCase()).digest('hex').slice(0, 32);
const hashFor = (password, email) => `pbkdf2$210000$${saltFor(email)}$${crypto.pbkdf2Sync(String(password), Buffer.from(saltFor(email), 'utf8'), 210000, 32, 'sha256').toString('hex')}`;
function promoterLogins() {
  const file = process.env.PROMOTER_LOGINS_FILE ? path.resolve(process.env.PROMOTER_LOGINS_FILE) : path.join(DIR, 'promoter-logins.json');
  if (!fs.existsSync(file)) return null;
  const L = JSON.parse(fs.readFileSync(file, 'utf8'));
  const promoters = (L.promoters || []).map((x) => ({ name: x.name, email: x.email, password_hash: x.password_hash || hashFor(x.password, x.email) }));
  // same version number as the HTML app, so a restored HTML backup does not apply the logins again
  const version = crypto.createHash('sha256').update(JSON.stringify(promoters)).digest('hex').slice(0, 16);
  return { version, promoters };
}

const DATA = {
  STARTING_DATA: readJson('starting-data.json') || { promoters: [], shops: [], gifts: [], models: [] },
  STARTING_BRANDS: readJson('brands.json'),
  PROMOTER_LOGINS: promoterLogins(),
  PROVIDED_SHOPS: readJson('provided-shops.json'),
  SHOP_ID_UPDATE: readJson('shop-id-update.json'),
};

module.exports = function register(G) {
  const { S } = G;

  G.createAdmin = async (email, pwd) => G.insert('users', { user_code: G.codes.admin(), name: 'System Admin', email: email.toLowerCase(), phone: null, password_hash: await G.hashPassword(pwd),
    role: 'admin', status: 'active', token_version: 0, last_login_at: null, created_at: G.now(), updated_at: G.now() });

  function loadModels() {
    const D = DATA.STARTING_DATA;
    if (S.models.length || !D.models) return;
    for (const m of D.models) G.insert('models', { item_code: m.item_code, model_name: m.model_name, brand_id: null, status: 'active', created_at: G.now(), updated_at: G.now() });
  }
  /** Create the provided brands and link the provided models to them (only models without a brand). */
  function loadBrands() {
    const list = (DATA.STARTING_BRANDS && DATA.STARTING_BRANDS.brands) || [];
    for (const b of list) {
      let brand = S.brands.find((x) => G.ieq(x.brand_name, b.brand_name));
      if (!brand) {
        const code = b.brand_code && !S.brands.some((x) => G.ieq(x.brand_code, b.brand_code)) ? b.brand_code : G.freeCode('brand', (c) => S.brands.some((x) => G.ieq(x.brand_code, c)));
        brand = G.insert('brands', { brand_code: code, brand_name: b.brand_name, status: 'active', created_at: G.now(), updated_at: G.now() });
        const n = parseInt(String(code).replace(/\D/g, ''), 10);
        if (n && (S.seq.brand || 0) < n) S.seq.brand = n;
      }
      for (const m of S.models) if (!m.brand_id && (b.models || []).some((c) => G.ieq(c, m.item_code))) m.brand_id = brand.id;
    }
  }
  /*
   * Fixed promoter logins (DATA.PROMOTER_LOGINS, from seed/promoter-logins.json). The file holds only
   * PBKDF2 hashes, never the passwords. Sets each listed promoter's email and password; runs again when the list changes.
   */
  const LOGINS = () => (DATA.PROMOTER_LOGINS && DATA.PROMOTER_LOGINS.promoters) || [];
  const loginFor = (name) => LOGINS().find((x) => G.ieq(x.name, name));
  G.applyPromoterLogins = () => {
    let changed = false;
    for (const x of LOGINS()) {
      const u = S.users.find((y) => y.role === 'promoter' && G.ieq(y.name, x.name));
      if (!u) continue;
      const email = x.email.toLowerCase();
      const emailOk = !S.users.some((y) => y.id !== u.id && G.ieq(y.email, email));
      const det = {};
      if (emailOk && u.email !== email) { det.email = { from: u.email, to: email }; u.email = email; }
      if (u.password_hash !== x.password_hash) { u.password_hash = x.password_hash; u.token_version++; S.sessions = S.sessions.filter((y) => y.user_id !== u.id); det.password_set = true; }
      if (Object.keys(det).length) { u.updated_at = G.now(); G.audit(null, 'user_updated', 'user', u.user_code, { via: 'fixed promoter logins', ...det }); changed = true; }
    }
    S.flags.promoterLogins = DATA.PROMOTER_LOGINS ? DATA.PROMOTER_LOGINS.version : null;
    return changed;
  };

  /**
   * Admin request: remove all old shops with their gift stock, sales / gift transactions, stock movements,
   * proof photos and promoter assignments. Promoters, gifts, brands, models, cities and markets stay.
   * Runs once; shops added afterwards are kept. Returns the photo keys to delete.
   */
  G.clearShops = () => {
    const photos = [];
    for (const t of S.txns) for (const k of [t.photo_path, t.mobile_photo_path]) if (k) photos.push(k);
    const counts = { shops: S.shops.length, allocations: S.inv.length, transactions: S.txns.length, movements: S.moves.length };
    S.shops = []; S.inv = []; S.txns = []; S.moves = [];
    G.reindex();
    S.seq.shop = 0;
    S.flags.shopsCleared1 = true;
    G.audit(null, 'shops_cleared', 'shop', null, { ...counts, via: 'admin request: remove old shops and promoter assignments' });
    return photos;
  };

  /**
   * The provided shops (DATA.PROVIDED_SHOPS): added with their Shop IDs, a new QR code and their promoter.
   * Each gift's warehouse stock is raised to gift_stock (never lowered) and every shop gets allocate_each
   * units of each active gift. Runs once (after the old shops were removed); later changes are kept.
   */
  G.addProvidedShops = () => {
    const P = DATA.PROVIDED_SHOPS;
    S.flags.shopsAdded2 = true;
    if (!P || !P.shops) return;
    const admin = S.users.find((u) => u.role === 'admin' && u.status === 'active') || S.users.find((u) => u.role === 'admin');
    const added = [];
    for (const x of P.shops) {
      const { city, market } = G.ensureCityMarket(x.city, x.market);
      const p = S.users.find((u) => u.role === 'promoter' && G.ieq(u.email, x.promoter_email));
      let shop = S.shops.find((y) => G.ieq(y.shop_id, x.shop_id));
      if (shop) {
        Object.assign(shop, { shop_name: x.shop_name, city_id: city.id, market_id: market.id, address: x.address, promoter_id: p ? p.id : shop.promoter_id, status: x.status || 'active', updated_at: G.now() });
      } else {
        shop = G.insert('shops', { shop_id: x.shop_id, shop_name: x.shop_name, city_id: city.id, market_id: market.id, address: x.address || null, owner_name: null, contact: null,
          promoter_id: p ? p.id : null, status: x.status === 'inactive' ? 'inactive' : 'active', qr_generated_at: G.now(), qr_version: 1, created_at: G.now(), updated_at: G.now() });
        G.audit(admin, 'shop_created', 'shop', shop.shop_id, { via: 'provided shops', promoter: p ? p.user_code : null });
        G.audit(admin, 'qr_generated', 'shop', shop.shop_id);
      }
      added.push(shop);
    }
    const each = Number(P.allocate_each) || 0;
    if (!each || !admin) return;
    for (const g of S.gifts.filter((y) => y.status === 'active')) {
      const need = S.inv.filter((i) => i.gift_id === g.id && !added.some((s) => s.id === i.shop_id)).reduce((a, i) => a + i.allocated_quantity, 0) + each * added.length;
      const target = Math.max(g.total_quantity, Number(P.gift_stock) || 0, need);
      if (target !== g.total_quantity) { G.audit(admin, 'gift_updated', 'gift', g.gift_id, { total_quantity: { from: g.total_quantity, to: target }, via: 'provided shops' }); g.total_quantity = target; g.updated_at = G.now(); }
      for (const shop of added) {
        const cur = (G.invRow(shop.id, g.id) || { allocated_quantity: 0 }).allocated_quantity;
        if (cur < each) G.setAllocation(shop, g, each, `Opening stock: ${each} per shop`, admin);
      }
    }
    G.audit(admin, 'inventory_allocated', 'shop_inventory', null, { via: 'provided shops', shops: added.length, per_gift_per_shop: each });
  };

  G.loadStartingData = async () => {
    const D = DATA.STARTING_DATA;
    const prom = {};
    // every promoter gets an own random salt, so equal passwords never give equal hashes
    for (const p of D.promoters) {
      if (!loginFor(p.name)) continue; // only promoters with a fixed login (no shared default password)
      prom[p.name] = G.insert('users', { user_code: G.codes.promoter(), name: p.name, email: loginFor(p.name).email.toLowerCase(), phone: p.phone || null, password_hash: loginFor(p.name).password_hash, role: 'promoter', status: 'active', token_version: 0, last_login_at: null, created_at: G.now(), updated_at: G.now() }).id;
    }
    const city = {}; const market = {};
    for (const s of D.shops) {
      if (!city[s.city]) city[s.city] = G.insert('cities', { city_name: s.city, created_at: G.now() }).id;
      const mk = s.city + '|' + s.market;
      if (!market[mk]) market[mk] = G.insert('markets', { city_id: city[s.city], market_name: s.market, created_at: G.now() }).id;
    }
    let maxNo = 0;
    for (const s of D.shops) {
      const created = G.ts(new Date(`${s.created}T10:00:00`));
      G.insert('shops', { shop_id: s.shop_id, shop_name: s.shop_name, city_id: city[s.city], market_id: market[s.city + '|' + s.market], address: s.address || null,
        owner_name: null, contact: null, promoter_id: prom[s.promoter] || null, status: s.status === 'inactive' ? 'inactive' : 'active',
        qr_generated_at: created, qr_version: 1, created_at: created, updated_at: created });
      const auto = String(s.shop_id).match(/^SHP-(\d+)$/i); // only system IDs move the auto-number
      if (auto) maxNo = Math.max(maxNo, parseInt(auto[1], 10));
    }
    S.seq.shop = maxNo; // the next new shop continues the numbering
    loadModels();
    loadBrands();
    for (const g of D.gifts) {
      const row = G.insert('gifts', { gift_id: G.codes.gift(), gift_name: g.gift_name, category: g.category, description: g.description, unit: g.unit || 'pcs', total_quantity: g.total_quantity, image_path: null, status: 'active', created_at: G.now(), updated_at: G.now() });
      const img = g.image && path.join(DIR, 'gift-images', path.basename(g.image));
      if (img && fs.existsSync(img)) { const key = `gift-images/${row.gift_id}-start`; await G.files.fileSet(key, new Blob([fs.readFileSync(img)], { type: 'image/jpeg' })); row.image_path = key; }
    }
  };

  /** Bring data saved by an older version up to date. Returns true when something changed. */
  G.migrate = () => {
    let changed = false;
    S.flags = S.flags || {};
    if (!S.settings || !S.settings.sales_mode) { S.settings = { ...(S.settings || {}), sales_mode: 'submitted' }; changed = true; }
    if (!S.models.length && !S.flags.modelsAdded) { loadModels(); S.flags.modelsAdded = true; changed = true; }
    if (!S.flags.noOwnerContact) { for (const sh of S.shops) { sh.owner_name = null; sh.contact = null; } S.flags.noOwnerContact = true; changed = true; }
    if (!S.flags.brandsAdded) { loadBrands(); S.flags.brandsAdded = true; changed = true; }
    if (!S.flags.shopIdsPK) { // the provided shops get their real Shop IDs (PK413451 …)
      for (const x of (DATA.SHOP_ID_UPDATE && DATA.SHOP_ID_UPDATE.shops) || []) {
        const shop = S.shops.find((y) => G.ieq(y.shop_id, x.from) && G.ieq(y.shop_name, x.shop_name));
        if (!shop || S.shops.some((y) => G.ieq(y.shop_id, x.to))) continue;
        shop.shop_id = x.to; shop.qr_generated_at = G.now(); shop.qr_version = (shop.qr_version || 1) + 1; shop.updated_at = G.now();
        G.audit(null, 'shop_updated', 'shop', x.to, { shop_id: { from: x.from, to: x.to }, via: 'Shop ID update' });
      }
      S.flags.shopIdsPK = true; changed = true;
    }
    if (!S.flags.v5) { // two-photo transactions: older records keep their single photo as the gift proof
      for (const t of S.txns) {
        if (t.mobile_qty === undefined) t.mobile_qty = null;
        if (!t.brand_id && t.model_id) { const m = G.byId('models', t.model_id); if (m && m.brand_id) t.brand_id = m.brand_id; }
      }
      for (const s of S.shops) if (!s.qr_generated_at) { s.qr_generated_at = s.created_at; s.qr_version = 1; }
      S.flags.v5 = true; changed = true;
    }
    if (DATA.PROMOTER_LOGINS && S.flags.promoterLogins !== DATA.PROMOTER_LOGINS.version) { G.applyPromoterLogins(); changed = true; }
    if (!S.flags.noApproval1) { // approval process removed: open sales become final, reserved gifts are deducted
      let n = 0;
      for (const t of S.txns) if (t.status === 'pending' || t.status === 'review') { t.status = 'approved'; n++; }
      for (const i of S.inv) if (i.pending_quantity) { i.distributed_quantity += i.pending_quantity; i.pending_quantity = 0; i.updated_at = G.now(); }
      if (n) G.audit(null, 'sales_finalised', 'transaction', null, { count: n, via: 'approval process removed' });
      S.settings = { ...(S.settings || {}), sales_mode: 'submitted' };
      S.flags.noApproval1 = true; changed = true;
    }
    if (!S.flags.shopsCleared1) { G.pendingPhotoDeletes = G.clearShops(); changed = true; }
    if (!S.flags.shopsAdded2) { G.addProvidedShops(); changed = true; } // after the clean-up and the fixed logins
    return changed;
  };

  /**
   * Make the admin from ADMIN_EMAIL / ADMIN_PASSWORD an active admin with that password
   * (first start, and after a backup restore so the server admin can always sign in).
   */
  G.envAdminConfigured = () => !!(config.ADMIN_EMAIL && config.ADMIN_PASSWORD);
  G.isEnvAdmin = (u) => !!config.ADMIN_EMAIL && G.ieq(u.email, config.ADMIN_EMAIL);
  G.ensureEnvAdmin = async () => {
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) return null;
    let a = S.users.find((u) => G.ieq(u.email, config.ADMIN_EMAIL));
    if (a) {
      Object.assign(a, { role: 'admin', status: 'active', password_hash: await G.hashPassword(config.ADMIN_PASSWORD), token_version: (a.token_version || 0) + 1, updated_at: G.now() });
    } else {
      a = await G.createAdmin(config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
    }
    return a;
  };

  /**
   * Start-up: load MongoDB; fill an empty database with the starting data; upgrade older data.
   */
  G.initData = async (store) => {
    await store.load();
    if (!S.users.length) {
      if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) throw new Error('The database is empty. Set ADMIN_EMAIL and ADMIN_PASSWORD so the first admin account can be created.');
      G.password(config.ADMIN_PASSWORD, 'ADMIN_PASSWORD');
      G.setState({});
      await G.createAdmin(config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
      S.flags = { noOwnerContact: true, modelsAdded: true, brandsAdded: true, v5: true, shopIdsPK: true, shopsCleared1: true, noApproval1: true, shopsAdded2: true };
      if (config.SEED_DATA) {
        await G.loadStartingData();
        if (!(DATA.STARTING_DATA.shops || []).length) G.addProvidedShops();
        S.flags.promoterLogins = DATA.PROMOTER_LOGINS ? DATA.PROMOTER_LOGINS.version : null;
      } else {
        S.flags.promoterLogins = DATA.PROMOTER_LOGINS ? DATA.PROMOTER_LOGINS.version : null;
      }
      G.audit(null, 'database_created', 'system', null, { starting_data: config.SEED_DATA, shops: S.shops.length, promoters: S.users.filter((u) => u.role === 'promoter').length, gifts: S.gifts.length });
      await G.persist();
      return { created: true };
    }
    if (G.migrate()) await G.persist();
    for (const k of G.pendingPhotoDeletes || []) await G.files.fileDel(k).catch(() => {}); // proof photos of removed sales
    G.pendingPhotoDeletes = null;
    return { created: false };
  };
  G.seedData = DATA;
};
