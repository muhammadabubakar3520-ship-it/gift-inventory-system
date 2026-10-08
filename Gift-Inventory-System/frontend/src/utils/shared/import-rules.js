import PromoterMatch from './promoter-match.js';
/* =====================================================================
   Excel Import rules — shared by the server, the single-file engine and
   the Excel Import Center screen.

   Flow:  Upload → Validate → Preview → Import
     toObjects(type, aoa)    sheet rows (array of arrays) -> objects with known keys
     validate(type, rows, ctx)  -> per-row status: ok | warn | error, plus the plan to apply
   The backend runs validate() again at import time with fresh data, then
   applies only the valid rows inside one transaction.

   ctx = { shops, promoters, emails, brands, models, gifts, inv, cities, markets, options }
   ===================================================================== */
const api = (function () {
  'use strict';

  const PM = PromoterMatch;
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const ieq = (a, b) => txt(a).toLowerCase() === txt(b).toLowerCase();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^[+0-9][0-9\s-]{6,19}$/;
  const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/;
  const DEFAULT_PASSWORD = 'Promoter@123';

  /* ---------- Column definitions (label is the template header) ---------- */
  const TYPES = {
    shops: {
      title: 'Shops', entity: 'shop',
      help: 'Shop ID is your own shop code (e.g. PK413451). Leave it blank to get an automatic ID. A row with an existing Shop ID updates that shop. With no Shop ID, a shop with the same name, city and market is updated (use this to assign promoters). New cities and markets are created. Promoter ID can be the promoter code (PRM-001), email or name.',
      columns: [
        { key: 'shop_id', label: 'Shop ID', aliases: ['shopid', 'shopcode', 'id'] },
        { key: 'shop_name', label: 'Shop Name', aliases: ['shopname', 'name', 'shop'], required: true },
        { key: 'city', label: 'City', aliases: ['city', 'cityname'], required: true },
        { key: 'market', label: 'Market', aliases: ['market', 'marketname', 'area'], required: true },
        { key: 'address', label: 'Address', aliases: ['address', 'shopaddress'] },
        { key: 'promoter', label: 'Promoter ID', aliases: ['promoterid', 'promoter', 'promotercode', 'promoteremail', 'promotername', 'assignedpromoter'] },
        { key: 'status', label: 'Status', aliases: ['status'] },
      ],
      example: [['PK413999', 'ABC Mobile Store', 'Lahore', 'Hall Road', 'Shop 5, Ground Floor', 'PRM-001', 'Active']],
    },
    brands: {
      title: 'Mobile Brands', entity: 'brand',
      help: 'Brand ID is optional (BR001 style IDs are created). A row with an existing Brand ID or name updates it.',
      columns: [
        { key: 'brand_code', label: 'Brand ID', aliases: ['brandid', 'brandcode', 'id'] },
        { key: 'brand_name', label: 'Brand Name', aliases: ['brandname', 'brand', 'name'], required: true },
        { key: 'status', label: 'Status', aliases: ['status'] },
      ],
      example: [['BR002', 'Samsung', 'Active']],
    },
    models: {
      title: 'Mobile Models', entity: 'model',
      help: 'Model ID is the model / item code and must be unique. The brand is matched by Brand ID or Brand Name; a new brand is created when the name is new.',
      columns: [
        { key: 'brand_code', label: 'Brand ID', aliases: ['brandid', 'brandcode'] },
        { key: 'brand_name', label: 'Brand Name', aliases: ['brandname', 'brand'] },
        { key: 'item_code', label: 'Model ID', aliases: ['modelid', 'modelcode', 'itemcode', 'item', 'code', 'sku'], required: true },
        { key: 'model_name', label: 'Model Name', aliases: ['modelname', 'model', 'name'], required: true },
        { key: 'status', label: 'Status', aliases: ['status'] },
      ],
      example: [['BR002', 'Samsung', 'MOD001', 'Galaxy A15', 'Active']],
    },
    gifts: {
      title: 'Gifts', entity: 'gift',
      help: 'Gift ID is optional. A row with an existing Gift ID or name updates it. Total Quantity is the warehouse stock and cannot go below what is already allocated to shops.',
      columns: [
        { key: 'gift_id', label: 'Gift ID', aliases: ['giftid', 'giftcode', 'id'] },
        { key: 'gift_name', label: 'Gift Name', aliases: ['giftname', 'gift', 'name'], required: true },
        { key: 'category', label: 'Category', aliases: ['category', 'type'] },
        { key: 'unit', label: 'Unit', aliases: ['unit', 'uom'] },
        { key: 'total_quantity', label: 'Total Quantity', aliases: ['totalquantity', 'quantity', 'qty', 'stock', 'totalstock'], required: true },
        { key: 'status', label: 'Status', aliases: ['status'] },
      ],
      example: [['GFT-101', 'Power Bank', 'Electronics', 'pcs', 100, 'Active']],
    },
    inventory: {
      title: 'Shop Gift Inventory', entity: 'shop_inventory',
      help: 'Sets how many of each gift a shop has been allocated. Choose "Set to this quantity" or "Add to current allocation". Stock comes from the gift\'s warehouse quantity.',
      columns: [
        { key: 'shop_id', label: 'Shop ID', aliases: ['shopid', 'shopcode', 'shop'], required: true },
        { key: 'gift_id', label: 'Gift ID', aliases: ['giftid', 'giftcode'] },
        { key: 'gift_name', label: 'Gift Name', aliases: ['giftname', 'gift'] },
        { key: 'quantity', label: 'Allocated Quantity', aliases: ['allocatedquantity', 'allocated', 'quantity', 'qty', 'allocation'], required: true },
      ],
      example: [['SHP-0001', 'GFT-001', 'Infinix Cap', 5], ['SHP-0001', 'GFT-002', 'Infinix Water Bottle', 5]],
    },
    promoters: {
      title: 'Promoters', entity: 'user',
      help: `Promoter ID is optional. A row with an existing Promoter ID or email updates that promoter. New promoters get the password in the file, or ${DEFAULT_PASSWORD} if it is blank. Passwords of existing promoters are fixed and are not changed.`,
      columns: [
        { key: 'user_code', label: 'Promoter ID', aliases: ['promoterid', 'promotercode', 'code', 'id'] },
        { key: 'name', label: 'Name', aliases: ['name', 'promotername', 'fullname'], required: true },
        { key: 'email', label: 'Email', aliases: ['email', 'emailaddress', 'login'], required: true },
        { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'contact', 'phonenumber'] },
        { key: 'password', label: 'Password', aliases: ['password', 'pwd'] },
        { key: 'status', label: 'Status', aliases: ['status'] },
      ],
      example: [['', 'Ali Khan', 'ali.khan@company.com', '0300-1234567', 'Promoter@123', 'Active']],
    },
  };

  /* ---------- Sheet rows -> objects ---------- */
  function toObjects(type, aoa) {
    const T = TYPES[type];
    if (!T) throw new Error('Unknown import type');
    const rows = (aoa || []).map((r) => (Array.isArray(r) ? r : []));
    const h = rows.findIndex((r) => r.some((c) => txt(c)));
    if (h < 0) return { header: [], missing: T.columns.filter((c) => c.required).map((c) => c.label), unknown: [], rows: [] };
    const header = rows[h].map(txt);
    const map = header.map((label) => {
      const n = norm(label);
      const col = T.columns.find((c) => c.aliases.includes(n) || norm(c.label) === n);
      return col ? col.key : null;
    });
    // a key may appear once; keep the first matching column
    const seen = new Set();
    map.forEach((k, i) => { if (k && seen.has(k)) map[i] = null; else if (k) seen.add(k); });
    const missing = T.columns.filter((c) => c.required && !seen.has(c.key)).map((c) => c.label);
    if (type === 'inventory' && !seen.has('gift_id') && !seen.has('gift_name')) missing.push('Gift ID or Gift Name');
    if (type === 'models' && !seen.has('brand_code') && !seen.has('brand_name')) missing.push('Brand ID or Brand Name');
    const unknown = header.filter((l, i) => l && !map[i]);
    const out = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.some((c) => txt(c))) continue;
      const o = { __line: i + 1 };
      map.forEach((k, j) => { if (k) o[k] = r[j] === undefined || r[j] === null ? '' : r[j]; });
      out.push(o);
    }
    return { header, missing, unknown, rows: out };
  }

  /* ---------- Small validators that collect messages ---------- */
  function status(v, msgs, dflt) {
    const s = txt(v).toLowerCase();
    if (!s) return dflt;
    if (['active', 'yes', 'y', '1', 'enabled'].includes(s)) return 'active';
    if (['inactive', 'no', 'n', '0', 'disabled'].includes(s)) return 'inactive';
    msgs.push({ level: 'error', text: `Status "${txt(v)}" must be Active or Inactive` });
    return dflt;
  }
  function wholeNumber(v, label, msgs, { min = 0, max = 100000000 } = {}) {
    const s = txt(v).replace(/,/g, '');
    if (s === '') { msgs.push({ level: 'error', text: `${label} is required` }); return null; }
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n)) { msgs.push({ level: 'error', text: `${label} must be a whole number` }); return null; }
    if (n < min) { msgs.push({ level: 'error', text: `${label} must be at least ${min}` }); return null; }
    if (n > max) { msgs.push({ level: 'error', text: `${label} is too large` }); return null; }
    return n;
  }
  function text(v, label, msgs, { required = false, max = 120 } = {}) {
    const s = txt(v);
    if (!s) { if (required) msgs.push({ level: 'error', text: `${label} is required` }); return null; }
    if (s.length > max) { msgs.push({ level: 'error', text: `${label} must be at most ${max} characters` }); return null; }
    return s;
  }
  const err = (msgs, t) => msgs.push({ level: 'error', text: t });
  const warn = (msgs, t) => msgs.push({ level: 'warn', text: t });

  /* ---------- Validation per type ---------- */
  const V = {};

  V.shops = (rows, ctx) => {
    const ids = new Set(); const names = new Set();
    const newPromoters = new Map();
    const out0 = rows.map((r) => {
      const m = [];
      const code = text(r.shop_id, 'Shop ID', m, { max: 20 });
      if (code && (!CODE_RE.test(code) || !/[A-Za-z]/.test(code))) err(m, 'Shop ID must be letters, numbers or dashes with at least one letter (e.g. PK413451)');
      const name = text(r.shop_name, 'Shop Name', m, { required: true, max: 120 });
      const city = text(r.city, 'City', m, { required: true, max: 80 });
      const market = text(r.market, 'Market', m, { required: true, max: 80 });
      const address = text(r.address, 'Address', m, { max: 250 });
      // no Shop ID: a shop with the same name in the same city and market is that shop (update, e.g. to assign a promoter)
      const sameName = !code && name && city && market ? ctx.shops.filter((s) => ieq(s.shop_name, name) && ieq(s.city_name, city) && ieq(s.market_name, market)) : [];
      const existing = code ? ctx.shops.find((s) => ieq(s.shop_id, code)) : sameName.length === 1 ? sameName[0] : null;
      const st = status(r.status, m, existing ? existing.status : 'active');
      if (code) {
        if (ids.has(code.toUpperCase())) err(m, `Shop ID ${code} appears more than once in the file`);
        ids.add(code.toUpperCase());
      }
      if (name && city && market) {
        const key = `${city}|${market}|${name}`.toLowerCase();
        const clash = ctx.shops.find((s) => ieq(s.shop_name, name) && ieq(s.city_name, city) && ieq(s.market_name, market) && (!existing || s.id !== existing.id));
        if (clash) err(m, `A shop named "${name}" already exists in ${market} (${clash.shop_id})`);
        else if (names.has(key)) err(m, `Shop "${name}" appears more than once for ${market}`);
        names.add(key);
        if (!ctx.cities.some((c) => ieq(c.city_name, city))) warn(m, `New city "${city}" will be created`);
        else if (!ctx.markets.some((x) => ieq(x.market_name, market) && ieq(x.city_name, city))) warn(m, `New market "${market}" will be created in ${city}`);
      }
      let promoter = null;
      const pcell = txt(r.promoter);
      if (pcell) {
        const found = PM.find(pcell, ctx.promoters);
        if (found) {
          if (found.status !== 'active') err(m, `Promoter "${found.name}" is inactive`);
          promoter = { id: found.id, name: found.name };
        } else if (ctx.options && ctx.options.create_promoters) {
          const info = PM.parse(pcell);
          if (!newPromoters.has(info.key)) newPromoters.set(info.key, { cell: pcell, name: info.name });
          promoter = { newKey: info.key, name: info.name };
          warn(m, `New promoter "${info.name}" will be created (password ${DEFAULT_PASSWORD})`);
        } else err(m, `Promoter "${pcell}" not found. Use the Promoter ID (e.g. PRM-001), email or exact name — or tick "Create missing promoters".`);
      }
      if (existing) warn(m, code ? `Existing shop ${existing.shop_id} will be updated` : `Existing shop ${existing.shop_id} (same name and market) will be updated`);
      return { line: r.__line, messages: m, action: existing ? 'update' : 'create',
        data: { id: existing ? existing.id : null, shop_id: code ? code.toUpperCase() : null, shop_name: name, city, market, address, promoter, status: st } };
    }).map(finish);
    return Object.assign(out0, { newPromoters });
  };

  V.brands = (rows, ctx) => {
    const seen = new Set();
    return rows.map((r) => {
      const m = [];
      const code = text(r.brand_code, 'Brand ID', m, { max: 20 });
      if (code && !CODE_RE.test(code)) err(m, 'Brand ID may contain only letters, numbers and dashes');
      const name = text(r.brand_name, 'Brand Name', m, { required: true, max: 60 });
      const existing = (code && ctx.brands.find((b) => ieq(b.brand_code, code))) || (name && ctx.brands.find((b) => ieq(b.brand_name, name))) || null;
      if (name && ctx.brands.some((b) => ieq(b.brand_name, name) && (!existing || b.id !== existing.id))) err(m, `Brand "${name}" already exists with another ID`);
      const key = (name || '').toLowerCase();
      if (key && seen.has(key)) err(m, `Brand "${name}" appears more than once in the file`);
      seen.add(key);
      const st = status(r.status, m, existing ? existing.status : 'active');
      if (existing) warn(m, `Existing brand ${existing.brand_code} will be updated`);
      return finish({ line: r.__line, messages: m, action: existing ? 'update' : 'create', data: { id: existing ? existing.id : null, brand_code: code ? code.toUpperCase() : null, brand_name: name, status: st } });
    });
  };

  V.models = (rows, ctx) => {
    const seen = new Set(); const newBrands = new Map();
    const out0 = rows.map((r) => {
      const m = [];
      const bcode = text(r.brand_code, 'Brand ID', m, { max: 20 });
      const bname = text(r.brand_name, 'Brand Name', m, { max: 60 });
      const code = text(r.item_code, 'Model ID', m, { required: true, max: 60 });
      const name = text(r.model_name, 'Model Name', m, { required: true, max: 80 });
      let brand = null;
      const found = (bcode && ctx.brands.find((b) => ieq(b.brand_code, bcode))) || (bname && ctx.brands.find((b) => ieq(b.brand_name, bname)));
      if (found) {
        if (bname && !ieq(found.brand_name, bname) && bcode && ieq(found.brand_code, bcode)) warn(m, `Brand ID ${bcode} is "${found.brand_name}" (file says "${bname}")`);
        brand = { id: found.id, brand_name: found.brand_name };
        if (found.status !== 'active') warn(m, `Brand ${found.brand_name} is inactive — promoters will not see this model`);
      } else if (bname) {
        const k = bname.toLowerCase();
        if (!newBrands.has(k)) newBrands.set(k, { brand_code: bcode ? bcode.toUpperCase() : null, brand_name: bname });
        brand = { newKey: k, brand_name: bname };
        warn(m, `New brand "${bname}" will be created`);
      } else if (bcode) err(m, `Brand ID ${bcode} not found. Add the Brand Name to create it.`);
      else err(m, 'Brand ID or Brand Name is required');
      const existing = code ? ctx.models.find((x) => ieq(x.item_code, code)) : null;
      if (code) { if (seen.has(code.toLowerCase())) err(m, `Model ID ${code} appears more than once in the file`); seen.add(code.toLowerCase()); }
      const st = status(r.status, m, existing ? existing.status : 'active');
      if (existing) warn(m, `Existing model ${existing.item_code} will be updated`);
      return finish({ line: r.__line, messages: m, action: existing ? 'update' : 'create', data: { id: existing ? existing.id : null, item_code: code, model_name: name, brand, status: st } });
    });
    return Object.assign(out0, { newBrands });
  };

  V.gifts = (rows, ctx) => {
    const seen = new Set();
    return rows.map((r) => {
      const m = [];
      const code = text(r.gift_id, 'Gift ID', m, { max: 20 });
      if (code && !CODE_RE.test(code)) err(m, 'Gift ID may contain only letters, numbers and dashes');
      const name = text(r.gift_name, 'Gift Name', m, { required: true, max: 100 });
      const qty = wholeNumber(r.total_quantity, 'Total Quantity', m, { min: 0 });
      const existing = (code && ctx.gifts.find((g) => ieq(g.gift_id, code))) || (!code && name && ctx.gifts.find((g) => ieq(g.gift_name, name))) || null;
      if (name && ctx.gifts.some((g) => ieq(g.gift_name, name) && (!existing || g.id !== existing.id))) err(m, `Gift "${name}" already exists with another ID`);
      const key = (name || '').toLowerCase();
      if (key && seen.has(key)) err(m, `Gift "${name}" appears more than once in the file`);
      seen.add(key);
      if (existing && qty !== null && qty < existing.allocated) err(m, `Total Quantity ${qty} is less than the ${existing.allocated} already allocated to shops`);
      const st = status(r.status, m, existing ? existing.status : 'active');
      if (existing) warn(m, `Existing gift ${existing.gift_id} will be updated (total ${existing.total_quantity} → ${qty ?? existing.total_quantity})`);
      return finish({ line: r.__line, messages: m, action: existing ? 'update' : 'create',
        data: { id: existing ? existing.id : null, gift_id: code ? code.toUpperCase() : null, gift_name: name, category: text(r.category, 'Category', m, { max: 60 }), unit: text(r.unit, 'Unit', m, { max: 20 }), total_quantity: qty, status: st } });
    });
  };

  V.inventory = (rows, ctx) => {
    const mode = ctx.options && ctx.options.mode === 'add' ? 'add' : 'set';
    const pairs = new Set();
    const use = new Map(); // gift pk -> extra warehouse stock used by earlier rows
    return rows.map((r) => {
      const m = [];
      const scode = text(r.shop_id, 'Shop ID', m, { required: true, max: 20 });
      const gcode = text(r.gift_id, 'Gift ID', m, { max: 20 });
      const gname = text(r.gift_name, 'Gift Name', m, { max: 100 });
      const qty = wholeNumber(r.quantity, 'Allocated Quantity', m, { min: mode === 'add' ? 1 : 0 });
      const shop = scode ? ctx.shops.find((s) => ieq(s.shop_id, scode)) : null;
      if (scode && !shop) err(m, `Shop ${scode} not found. Upload the shop first.`);
      if (shop && shop.status !== 'active') err(m, `Shop ${shop.shop_id} is inactive`);
      const gift = (gcode && ctx.gifts.find((g) => ieq(g.gift_id, gcode))) || (!gcode && gname && ctx.gifts.find((g) => ieq(g.gift_name, gname))) || null;
      if (!gcode && !gname) err(m, 'Gift ID or Gift Name is required');
      else if (!gift) err(m, `Gift ${gcode || gname} not found. Upload the gift first.`);
      if (gift && gcode && gname && !ieq(gift.gift_name, gname)) warn(m, `Gift ID ${gift.gift_id} is "${gift.gift_name}" (file says "${gname}")`);
      if (gift && gift.status !== 'active') err(m, `Gift ${gift.gift_name} is inactive`);
      let before = 0, after = null, delta = 0;
      if (shop && gift) {
        const k = `${shop.id}|${gift.id}`;
        if (pairs.has(k)) err(m, `${shop.shop_id} / ${gift.gift_name} appears more than once in the file`);
        pairs.add(k);
        const cur = (ctx.inv && ctx.inv[k]) || { allocated: 0, distributed: 0, pending: 0 };
        before = cur.allocated;
        if (qty !== null) {
          after = mode === 'add' ? before + qty : qty;
          delta = after - before;
          const committed = cur.distributed + cur.pending;
          if (after < committed) err(m, `Cannot set ${after}: ${cur.distributed} already given and ${cur.pending} waiting for approval at this shop`);
          if (delta > 0 && !m.some((x) => x.level === 'error')) {
            const unallocated = gift.total_quantity - gift.allocated - (use.get(gift.id) || 0);
            if (delta > unallocated) err(m, `Not enough warehouse stock for ${gift.gift_name}: ${Math.max(0, unallocated)} unallocated, this row needs ${delta}`);
            else use.set(gift.id, (use.get(gift.id) || 0) + delta);
          }
          if (delta < 0 && !m.some((x) => x.level === 'error')) use.set(gift.id, (use.get(gift.id) || 0) + delta);
        }
      }
      const res = finish({ line: r.__line, messages: m, action: 'set',
        data: { shop_pk: shop ? shop.id : null, gift_pk: gift ? gift.id : null, shop_id: shop ? shop.shop_id : scode, shop_name: shop ? shop.shop_name : null, gift_id: gift ? gift.gift_id : gcode, gift_name: gift ? gift.gift_name : gname, before, after, delta } });
      if (res.status !== 'error' && delta === 0) { res.action = 'skip'; res.messages.push({ level: 'info', text: 'No change' }); }
      return res;
    });
  };

  V.promoters = (rows, ctx) => {
    const emails = new Set();
    return rows.map((r) => {
      const m = [];
      const code = text(r.user_code, 'Promoter ID', m, { max: 20 });
      const name = text(r.name, 'Name', m, { required: true, max: 100 });
      const email = text(r.email, 'Email', m, { required: true, max: 120 });
      if (email && !EMAIL_RE.test(email)) err(m, `Email "${email}" is not valid`);
      const phone = text(r.phone, 'Phone', m, { max: 20 });
      if (phone && !PHONE_RE.test(phone)) err(m, `Phone "${phone}" is not valid`);
      const pwd = text(r.password, 'Password', m, { max: 72 });
      if (pwd && (pwd.length < 8 || !/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd))) err(m, 'Password must be at least 8 characters with letters and numbers');
      const existing = (code && ctx.promoters.find((p) => ieq(p.user_code, code))) || (email && ctx.promoters.find((p) => ieq(p.email, email))) || null;
      if (code && !existing) err(m, `Promoter ID ${code} not found. Leave it blank to create a new promoter.`);
      if (email) {
        if (ctx.emails.some((e) => ieq(e.email, email) && (!existing || e.id !== existing.id))) err(m, `Email ${email} is already used by another account`);
        if (emails.has(email.toLowerCase())) err(m, `Email ${email} appears more than once in the file`);
        emails.add(email.toLowerCase());
      }
      const st = status(r.status, m, existing ? existing.status : 'active');
      if (existing) { warn(m, `Existing promoter ${existing.user_code} will be updated`); if (pwd) warn(m, 'Password is fixed and will not be changed'); }
      else if (!pwd) warn(m, `Password will be ${DEFAULT_PASSWORD}`);
      return finish({ line: r.__line, messages: m, action: existing ? 'update' : 'create',
        data: { id: existing ? existing.id : null, user_code: existing ? existing.user_code : null, name, email: email ? email.toLowerCase() : null, phone, password: existing ? null : (pwd || DEFAULT_PASSWORD), status: st } }); // passwords of existing users are fixed
    });
  };

  function finish(x) {
    const hasErr = x.messages.some((m) => m.level === 'error');
    const hasWarn = x.messages.some((m) => m.level === 'warn');
    x.status = hasErr ? 'error' : hasWarn ? 'warn' : 'ok';
    return x;
  }

  /** Validate all rows. Returns { total, valid, warnings, errors, skipped, rows, extra } */
  function validate(type, rows, ctx) {
    if (!V[type]) throw new Error('Unknown import type');
    if (!Array.isArray(rows)) rows = [];
    const out = V[type](rows, ctx);
    out.forEach((x, i) => { const { __line, ...input } = rows[i] || {}; x.input = input; void __line; });
    const res = { type, total: out.length, valid: 0, warnings: 0, errors: 0, skipped: 0, rows: out };
    for (const r of out) {
      if (r.status === 'error') res.errors++;
      else { res.valid++; if (r.status === 'warn') res.warnings++; if (r.action === 'skip') res.skipped++; }
    }
    if (out.newPromoters) res.newPromoters = [...out.newPromoters.entries()].map(([key, v]) => ({ key, ...v }));
    if (out.newBrands) res.newBrands = [...out.newBrands.entries()].map(([key, v]) => ({ key, ...v }));
    return res;
  }

  const api = { TYPES, DEFAULT_PASSWORD, toObjects, validate, norm };
  return api;
})();
export default api;
