'use strict';
/* gifts.js — gift catalogue, warehouse stock and gift images. */
module.exports = function register(G) {
  const { S, R } = G;

  R('GET', '/gifts', 'admin', ({ query }) => {
    const s = G.like(query.search);
    return S.gifts.map(G.giftView).filter((g) => (!s || s(g.gift_id, g.gift_name, g.category)) && (!query.status || g.status === query.status) && (!query.category || g.category === query.category)).sort((a, b) => a.id - b.id);
  });
  R('GET', '/gifts/categories', 'admin', () => [...new Set(S.gifts.map((g) => g.category).filter(Boolean))].sort());
  R('GET', '/gifts/:id', 'admin', ({ params }) => {
    const g = G.giftView(G.findGift(params.id));
    const shops = S.inv.filter((i) => i.gift_id === g.id && i.allocated_quantity > 0).map(G.invView)
      .map((i) => ({ id: i.shop_pk, shop_id: i.shop_id, shop_name: i.shop_name, city_name: i.city_name, market_name: i.market_name, allocated: i.allocated, distributed: i.distributed, pending: i.pending, remaining: i.remaining }))
      .sort((a, b) => b.remaining - a.remaining).slice(0, 200);
    return { gift: g, shops };
  });
  function readGiftBody(b) {
    return {
      gift_name: G.str(b.gift_name, { field: 'Gift name', required: true, max: 100 }), category: G.str(b.category, { field: 'Category', max: 60 }),
      description: G.str(b.description, { field: 'Description', max: 500 }), unit: G.str(b.unit, { field: 'Unit', max: 20 }) || 'pcs',
      total_quantity: G.int(b.total_quantity, { field: 'Total available quantity', min: 0, max: 100_000_000 }),
      status: G.oneOf(b.status, ['active', 'inactive'], { field: 'Status', dflt: 'active' }),
    };
  }
  G.createGift = (b, actor, via) => {
    const code = b.gift_id || G.freeCode('gift', (c) => S.gifts.some((x) => G.ieq(x.gift_id, c)));
    const g = G.insert('gifts', { gift_id: code, gift_name: b.gift_name, category: b.category || null, description: b.description || null, unit: b.unit || 'pcs',
      total_quantity: b.total_quantity || 0, image_path: null, status: b.status || 'active', created_at: G.now(), updated_at: G.now() });
    G.audit(actor, 'gift_created', 'gift', g.gift_id, { ...b, via });
    return g;
  };
  R('POST', '/gifts', 'admin', ({ body, user }) => {
    const b = readGiftBody(body);
    if (S.gifts.some((g) => G.ieq(g.gift_name, b.gift_name))) throw G.conflict(`Gift "${b.gift_name}" already exists`);
    return G.giftView(G.createGift(b, user));
  }, { write: true });
  R('PUT', '/gifts/:id', 'admin', ({ params, body, user }) => {
    const g = G.findGift(params.id);
    const b = readGiftBody(body);
    if (S.gifts.some((x) => x.id !== g.id && G.ieq(x.gift_name, b.gift_name))) throw G.conflict(`Gift "${b.gift_name}" already exists`);
    const alloc = G.giftAllocated(g.id);
    if (b.total_quantity < alloc) throw G.conflict(`Total quantity cannot be less than the quantity already allocated to shops (${alloc}).`);
    Object.assign(g, b, { updated_at: G.now() });
    G.audit(user, 'gift_updated', 'gift', g.gift_id, b);
    return G.giftView(g);
  }, { write: true });
  R('POST', '/gifts/:id/stock', 'admin', ({ params, body, user }) => {
    const g = G.findGift(params.id);
    const qty = G.int(body.quantity, { field: 'Quantity', min: 1, max: 10_000_000 });
    const note = G.str(body.note, { field: 'Note', max: 200 });
    const before = g.total_quantity;
    g.total_quantity += qty; g.updated_at = G.now();
    G.audit(user, 'gift_stock_received', 'gift', g.gift_id, { quantity: qty, before, after: g.total_quantity, note });
    return G.giftView(g);
  }, { write: true });
  R('PATCH', '/gifts/:id/status', 'admin', ({ params, body, user }) => {
    const g = G.findGift(params.id);
    g.status = G.oneOf(body.status, ['active', 'inactive'], { field: 'Status', required: true }); g.updated_at = G.now();
    G.audit(user, g.status === 'active' ? 'gift_activated' : 'gift_deactivated', 'gift', g.gift_id);
    return { ok: true };
  }, { write: true });
  R('POST', '/gifts/:id/image', 'admin', async ({ params, form, user }) => {
    const g = G.findGift(params.id);
    const f = await G.readImage(form && form.get('image'), 'Gift image');
    const key = `gift-images/${g.gift_id}-${G.randHex(6)}`;
    await G.files.fileSet(key, f);
    if (g.image_path) G.files.fileDel(g.image_path).catch(() => {});
    g.image_path = key; g.updated_at = G.now();
    G.audit(user, 'gift_image_updated', 'gift', g.gift_id);
    return G.giftView(g);
  }, { write: true });
};
