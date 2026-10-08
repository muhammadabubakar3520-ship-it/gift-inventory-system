'use strict';
/* models.js — mobile phone models, each linked to a brand. */
module.exports = function register(G) {
  const { S, R } = G;

  G.modelView = (m) => {
    const b = m.brand_id ? G.byId('brands', m.brand_id) : null;
    const tx = S.txns.filter((t) => t.model_id === m.id);
    const sold = tx.filter(G.isCounted);
    return { ...m, brand_code: b ? b.brand_code : null, brand_name: b ? b.brand_name : null, brand_status: b ? b.status : null,
      transactions: tx.length, units_sold: G.sum(sold, 'mobile_qty'), gifts_given: G.sum(sold, 'quantity') };
  };
  function readBody(b) {
    const out = { brand_id: G.int(b.brand_id, { field: 'Brand', min: 1, msg: 'Please select the brand' }),
      item_code: G.str(b.item_code, { field: 'Model ID', required: true, max: 60 }), model_name: G.str(b.model_name, { field: 'Model name', required: true, max: 80 }),
      status: G.oneOf(b.status, ['active', 'inactive'], { field: 'Status', dflt: 'active' }) };
    if (!G.byId('brands', out.brand_id)) throw G.notFound('Brand');
    return out;
  }
  const findModel = (id) => { const m = G.byId('models', id); if (!m) throw G.notFound('Model'); return m; };

  R('GET', '/models', 'admin', ({ query }) => {
    const s = G.like(query.search);
    return S.models.filter((m) => (!s || s(m.item_code, m.model_name)) && (!query.brand_id || (query.brand_id === 'none' ? !m.brand_id : m.brand_id === Number(query.brand_id))) && (!query.status || m.status === query.status))
      .map(G.modelView).sort((a, b) => String(a.brand_name || '~').localeCompare(String(b.brand_name || '~')) || a.id - b.id);
  });
  R('POST', '/models', 'admin', ({ body, user }) => {
    const b = readBody(body);
    if (S.models.some((m) => G.ieq(m.item_code, b.item_code))) throw G.conflict(`Model ID "${b.item_code}" already exists`);
    const m = G.insert('models', { ...b, created_at: G.now(), updated_at: G.now() });
    G.audit(user, 'model_created', 'model', b.item_code, b);
    return G.modelView(m);
  }, { write: true });
  R('PUT', '/models/:id', 'admin', ({ params, body, user }) => {
    const m = findModel(params.id); const b = readBody(body);
    if (S.models.some((x) => x.id !== m.id && G.ieq(x.item_code, b.item_code))) throw G.conflict(`Model ID "${b.item_code}" already exists`);
    Object.assign(m, b, { updated_at: G.now() });
    G.audit(user, 'model_updated', 'model', b.item_code, b);
    return G.modelView(m);
  }, { write: true });
  R('PATCH', '/models/:id/status', 'admin', ({ params, body, user }) => {
    const m = findModel(params.id);
    m.status = G.oneOf(body.status, ['active', 'inactive'], { field: 'Status', required: true }); m.updated_at = G.now();
    G.audit(user, m.status === 'active' ? 'model_activated' : 'model_deactivated', 'model', m.item_code);
    return { ok: true };
  }, { write: true });
};
