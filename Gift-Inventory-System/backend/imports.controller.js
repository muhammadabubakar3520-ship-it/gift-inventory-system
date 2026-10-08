'use strict';
/* =====================================================================
   imports.js — Excel Import Center backend.
   POST /import/:type { rows, options, commit }
     commit=false  → validation only (Total / Valid / Warnings / Errors + per-row messages)
     commit=true   → validates again with fresh data, then imports the valid rows
                     (rows with errors are skipped and reported). All-or-nothing on failure.
   Types: shops, brands, models, gifts, inventory, promoters
   ===================================================================== */
module.exports = function register(G) {
  const { S, R } = G;
  const IR = () => G.ImportRules;
  const PM = () => G.PromoterMatch;

  function context(options) {
    const inv = {};
    for (const i of S.inv) inv[`${i.shop_id}|${i.gift_id}`] = { allocated: i.allocated_quantity, distributed: i.distributed_quantity, pending: i.pending_quantity };
    return {
      shops: S.shops.map((s) => ({ id: s.id, shop_id: s.shop_id, shop_name: s.shop_name, status: s.status, city_name: (G.byId('cities', s.city_id) || {}).city_name, market_name: (G.byId('markets', s.market_id) || {}).market_name })),
      promoters: S.users.filter((u) => u.role === 'promoter').map((u) => ({ id: u.id, user_code: u.user_code, name: u.name, email: u.email, status: u.status })),
      emails: S.users.map((u) => ({ id: u.id, email: u.email })),
      brands: S.brands.map((b) => ({ ...b })), models: S.models.map((m) => ({ ...m })),
      gifts: S.gifts.map((g) => ({ id: g.id, gift_id: g.gift_id, gift_name: g.gift_name, status: g.status, total_quantity: g.total_quantity, allocated: G.giftAllocated(g.id) })),
      cities: S.cities.map((c) => ({ city_name: c.city_name })), markets: S.markets.map((m) => ({ market_name: m.market_name, city_name: (G.byId('cities', m.city_id) || {}).city_name })),
      inv, options: options || {},
    };
  }
  G.importContext = context;

  const APPLY = {
    async shops(res, user) {
      const newIds = new Map();
      const usedKeys = new Set(res.rows.filter((r) => r.status !== 'error' && r.data.promoter && r.data.promoter.newKey).map((r) => r.data.promoter.newKey));
      const newPromoters = [];
      for (const np of res.newPromoters || []) {
        if (!usedKeys.has(np.key)) continue;
        const email = PM().newEmail(np.cell, S.users.map((u) => u.email));
        const u = await G.createUser({ name: np.name, email, role: 'promoter', password: IR().DEFAULT_PASSWORD }, user, 'shop import'); // own salt per user
        newIds.set(np.key, u.id);
        newPromoters.push({ name: u.name, email: u.email, user_code: u.user_code });
      }
      let created = 0, updated = 0;
      for (const r of res.rows) {
        if (r.status === 'error') continue;
        const d = r.data;
        const { city, market } = G.ensureCityMarket(d.city, d.market);
        const promoterId = d.promoter ? (d.promoter.newKey ? newIds.get(d.promoter.newKey) : d.promoter.id) : undefined;
        if (r.action === 'update') {
          const s = G.byId('shops', d.id);
          const before = { shop_name: s.shop_name, city_id: s.city_id, market_id: s.market_id, address: s.address, promoter_id: s.promoter_id, status: s.status };
          Object.assign(s, { shop_name: d.shop_name, city_id: city.id, market_id: market.id, status: d.status, updated_at: G.now() });
          if (d.address) s.address = d.address;
          if (promoterId !== undefined) s.promoter_id = promoterId;
          G.audit(user, 'shop_updated', 'shop', s.shop_id, { via: 'excel import', before });
          updated++;
        } else {
          const code = d.shop_id && !S.shops.some((x) => G.ieq(x.shop_id, d.shop_id)) ? d.shop_id : G.freeCode('shop', (c) => S.shops.some((x) => G.ieq(x.shop_id, c)));
          const s = G.insert('shops', { shop_id: code, shop_name: d.shop_name, city_id: city.id, market_id: market.id, address: d.address, owner_name: null, contact: null,
            promoter_id: promoterId || null, status: d.status, qr_generated_at: G.now(), qr_version: 1, created_at: G.now(), updated_at: G.now() });
          G.audit(user, 'shop_created', 'shop', s.shop_id, { via: 'excel import' });
          G.audit(user, 'qr_generated', 'shop', s.shop_id);
          created++;
        }
      }
      return { created, updated, new_promoters: newPromoters, new_promoter_password: newPromoters.length ? IR().DEFAULT_PASSWORD : null };
    },
    brands(res, user) {
      let created = 0, updated = 0;
      for (const r of res.rows) {
        if (r.status === 'error') continue;
        const d = r.data;
        if (r.action === 'update') {
          const b = G.byId('brands', d.id);
          Object.assign(b, { brand_name: d.brand_name, status: d.status, brand_code: d.brand_code || b.brand_code, updated_at: G.now() });
          G.audit(user, 'brand_updated', 'brand', b.brand_code, { via: 'excel import' });
          updated++;
        } else { G.createBrand({ brand_code: d.brand_code && !S.brands.some((x) => G.ieq(x.brand_code, d.brand_code)) ? d.brand_code : null, brand_name: d.brand_name, status: d.status }, user, 'excel import'); created++; }
      }
      return { created, updated };
    },
    models(res, user) {
      const newBrandIds = new Map();
      let brandsCreated = 0;
      const usedKeys = new Set(res.rows.filter((r) => r.status !== 'error' && r.data.brand && r.data.brand.newKey).map((r) => r.data.brand.newKey));
      for (const nb of res.newBrands || []) {
        if (!usedKeys.has(nb.key)) continue;
        const b = G.createBrand({ brand_code: nb.brand_code && !S.brands.some((x) => G.ieq(x.brand_code, nb.brand_code)) ? nb.brand_code : null, brand_name: nb.brand_name }, user, 'excel import');
        newBrandIds.set(nb.key, b.id); brandsCreated++;
      }
      let created = 0, updated = 0;
      for (const r of res.rows) {
        if (r.status === 'error') continue;
        const d = r.data;
        const brandId = d.brand.newKey ? newBrandIds.get(d.brand.newKey) : d.brand.id;
        if (r.action === 'update') {
          const m = G.byId('models', d.id);
          Object.assign(m, { item_code: d.item_code, model_name: d.model_name, brand_id: brandId, status: d.status, updated_at: G.now() });
          G.audit(user, 'model_updated', 'model', m.item_code, { via: 'excel import' });
          updated++;
        } else {
          const m = G.insert('models', { item_code: d.item_code, model_name: d.model_name, brand_id: brandId, status: d.status, created_at: G.now(), updated_at: G.now() });
          G.audit(user, 'model_created', 'model', m.item_code, { via: 'excel import' });
          created++;
        }
      }
      return { created, updated, brands_created: brandsCreated };
    },
    gifts(res, user) {
      let created = 0, updated = 0;
      for (const r of res.rows) {
        if (r.status === 'error') continue;
        const d = r.data;
        if (r.action === 'update') {
          const g = G.byId('gifts', d.id);
          if (d.total_quantity < G.giftAllocated(g.id)) throw G.conflict(`${g.gift_name}: total quantity cannot be below the allocated quantity`);
          Object.assign(g, { gift_name: d.gift_name, total_quantity: d.total_quantity, status: d.status, updated_at: G.now() });
          if (d.category) g.category = d.category;
          if (d.unit) g.unit = d.unit;
          G.audit(user, 'gift_updated', 'gift', g.gift_id, { via: 'excel import', total_quantity: d.total_quantity });
          updated++;
        } else {
          G.createGift({ gift_id: d.gift_id && !S.gifts.some((x) => G.ieq(x.gift_id, d.gift_id)) ? d.gift_id : null, gift_name: d.gift_name, category: d.category, unit: d.unit, total_quantity: d.total_quantity, status: d.status }, user, 'excel import');
          created++;
        }
      }
      return { created, updated };
    },
    inventory(res, user, options) {
      const lines = res.rows.filter((r) => r.status !== 'error' && r.action !== 'skip').map((r) => r.data);
      lines.sort((a, b) => a.delta - b.delta); // decreases first, so freed stock can be reused
      const changes = [];
      for (const d of lines) {
        const shop = G.byId('shops', d.shop_pk); const gift = G.byId('gifts', d.gift_pk);
        if (d.delta > 0) {
          const unallocated = gift.total_quantity - G.giftAllocated(gift.id);
          if (d.delta > unallocated) throw G.conflict(`Not enough warehouse stock for ${gift.gift_name}`);
        }
        const x = G.setAllocation(shop, gift, d.after, `Excel upload (${options.mode === 'add' ? 'add' : 'set'})`, user);
        if (x) changes.push({ shop: shop.shop_id, gift: gift.gift_id, before: x.before, after: x.after });
      }
      G.audit(user, 'inventory_uploaded', 'shop_inventory', null, { mode: options.mode === 'add' ? 'add' : 'set', lines: changes.length,
        added: changes.reduce((a, c) => a + Math.max(0, c.after - c.before), 0), removed: changes.reduce((a, c) => a + Math.max(0, c.before - c.after), 0), changes: changes.slice(0, 100) });
      return { updated: changes.length, quantity_added: changes.reduce((a, c) => a + Math.max(0, c.after - c.before), 0), quantity_removed: changes.reduce((a, c) => a + Math.max(0, c.before - c.after), 0) };
    },
    async promoters(res, user) {
      let created = 0, updated = 0;
      for (const r of res.rows) {
        if (r.status === 'error') continue;
        const d = r.data;
        if (r.action === 'update') {
          const u = G.byId('users', d.id);
          if (u.status !== d.status) u.token_version++;
          Object.assign(u, { name: d.name, email: d.email, status: d.status, updated_at: G.now() });
          if (d.phone) u.phone = d.phone;
          if (d.password) { u.password_hash = await G.hashPassword(d.password); u.token_version++; }
          G.audit(user, 'user_updated', 'user', u.user_code, { via: 'excel import', password_reset: !!d.password });
          updated++;
        } else {
          await G.createUser({ name: d.name, email: d.email, phone: d.phone, role: 'promoter', status: d.status, password: d.password }, user, 'excel import');
          created++;
        }
      }
      return { created, updated };
    },
  };

  R('POST', '/import/:type', 'admin', async ({ params, body, user }) => {
    const type = params.type;
    if (!IR().TYPES[type]) throw G.notFound('Import type');
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw G.bad('The file has no data rows');
    if (rows.length > 5000) throw G.bad('Import at most 5,000 rows at a time');
    const options = { mode: body.options && body.options.mode === 'add' ? 'add' : 'set', create_promoters: !!(body.options && body.options.create_promoters) };
    const res = IR().validate(type, rows, context(options));
    if (!body.commit) return res;
    if (!res.valid) throw G.bad('There are no valid rows to import. Fix the errors and upload again.', res.rows.filter((r) => r.status === 'error').slice(0, 50));
    const out = await APPLY[type](res, user, options);
    G.audit(user, `import_${type}`, type, null, { rows: res.total, imported: res.valid - res.skipped, skipped_errors: res.errors, ...out, changes: undefined });
    return { ok: true, type, total: res.total, valid: res.valid, warnings: res.warnings, errors: res.errors, skipped: res.skipped, ...out, rows: res.rows };
  }, { write: true });
};
