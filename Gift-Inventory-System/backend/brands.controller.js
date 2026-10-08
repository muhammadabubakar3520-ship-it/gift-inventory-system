'use strict';
/* brands.js — mobile brands (Samsung, Vivo, Infinix, …). */
module.exports = function register(G) {
  const { S, R } = G;

  G.brandView = (b) => {
    const models = S.models.filter((m) => m.brand_id === b.id);
    const sold = S.txns.filter((t) => G.isCounted(t) && (t.brand_id === b.id || (!t.brand_id && models.some((m) => m.id === t.model_id))));
    return { ...b, model_count: models.length, active_models: models.filter((m) => m.status === 'active').length, units_sold: G.sum(sold, 'mobile_qty'), gifts_given: G.sum(sold, 'quantity') };
  };
  const findBrand = (id) => { const b = /^\d+$/.test(String(id)) ? G.byId('brands', id) : S.brands.find((x) => G.ieq(x.brand_code, id)); if (!b) throw G.notFound('Brand'); return b; };
  G.findBrand = findBrand;
  G.createBrand = (b, actor, via) => {
    const code = b.brand_code || G.freeCode('brand', (c) => S.brands.some((x) => G.ieq(x.brand_code, c)));
    const row = G.insert('brands', { brand_code: code, brand_name: b.brand_name, status: b.status || 'active', created_at: G.now(), updated_at: G.now() });
    G.audit(actor, 'brand_created', 'brand', code, { name: row.brand_name, via });
    return row;
  };
  function readBody(b) {
    const code = G.str(b.brand_code, { field: 'Brand ID', max: 20, pattern: /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/, patternMsg: 'Brand ID may contain only letters, numbers and dashes' });
    return { brand_code: code ? code.toUpperCase() : null, brand_name: G.str(b.brand_name, { field: 'Brand name', required: true, max: 60 }),
      status: G.oneOf(b.status, ['active', 'inactive'], { field: 'Status', dflt: 'active' }) };
  }

  R('GET', '/brands', 'admin', ({ query }) => {
    const s = G.like(query.search);
    return S.brands.filter((b) => (!s || s(b.brand_code, b.brand_name)) && (!query.status || b.status === query.status)).map(G.brandView).sort((a, b) => a.brand_name.localeCompare(b.brand_name));
  });
  R('POST', '/brands', 'admin', ({ body, user }) => {
    const b = readBody(body);
    if (S.brands.some((x) => G.ieq(x.brand_name, b.brand_name))) throw G.conflict(`Brand "${b.brand_name}" already exists`);
    if (b.brand_code && S.brands.some((x) => G.ieq(x.brand_code, b.brand_code))) throw G.conflict(`Brand ID ${b.brand_code} already exists`);
    return G.brandView(G.createBrand(b, user));
  }, { write: true });
  R('PUT', '/brands/:id', 'admin', ({ params, body, user }) => {
    const br = findBrand(params.id);
    const b = readBody(body);
    if (S.brands.some((x) => x.id !== br.id && G.ieq(x.brand_name, b.brand_name))) throw G.conflict(`Brand "${b.brand_name}" already exists`);
    if (b.brand_code && S.brands.some((x) => x.id !== br.id && G.ieq(x.brand_code, b.brand_code))) throw G.conflict(`Brand ID ${b.brand_code} already exists`);
    Object.assign(br, { brand_name: b.brand_name, status: b.status, brand_code: b.brand_code || br.brand_code, updated_at: G.now() });
    G.audit(user, 'brand_updated', 'brand', br.brand_code, b);
    return G.brandView(br);
  }, { write: true });
  R('PATCH', '/brands/:id/status', 'admin', ({ params, body, user }) => {
    const br = findBrand(params.id);
    br.status = G.oneOf(body.status, ['active', 'inactive'], { field: 'Status', required: true }); br.updated_at = G.now();
    G.audit(user, br.status === 'active' ? 'brand_activated' : 'brand_deactivated', 'brand', br.brand_code);
    return { ok: true };
  }, { write: true });

  /** Brands with their active models — what the promoter can choose from. */
  R('GET', '/promoter/brands', 'promoter', () => S.brands.filter((b) => b.status === 'active').map((b) => ({
    id: b.id, brand_code: b.brand_code, brand_name: b.brand_name,
    models: S.models.filter((m) => m.brand_id === b.id && m.status === 'active').map((m) => ({ id: m.id, item_code: m.item_code, model_name: m.model_name })).sort((a, c) => a.model_name.localeCompare(c.model_name)),
  })).filter((b) => b.models.length).sort((a, b) => a.brand_name.localeCompare(b.brand_name)));
};
