'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const registerSeed = require('../src/services/seed');

function fakeEngine() {
  const G = {
    S: { users: [], cities: [], markets: [], shops: [], gifts: [], inv: [], flags: {} },
    sequences: { admin: 0, promoter: 0 },
    codes: {
      admin: () => `ADM-${String(++G.sequences.admin).padStart(3, '0')}`,
      promoter: () => `PRM-${String(++G.sequences.promoter).padStart(3, '0')}`,
    },
    freeCode(kind, exists) {
      let code;
      do code = G.codes[kind](); while (exists(code));
      return code;
    },
    ieq: (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase(),
    insert(collection, row) {
      row.id = G.S[collection].length + 1;
      G.S[collection].push(row);
      return row;
    },
    ensureCityMarket(cityName, marketName) {
      let city = G.S.cities.find((row) => G.ieq(row.city_name, cityName));
      if (!city) city = G.insert('cities', { city_name: cityName });
      let market = G.S.markets.find((row) => row.city_id === city.id && G.ieq(row.market_name, marketName));
      if (!market) market = G.insert('markets', { city_id: city.id, market_name: marketName });
      return { city, market };
    },
    shopPromoterIds: (shop) => shop.promoter_ids || (shop.promoter_id ? [shop.promoter_id] : []),
    now: () => '2026-10-14 00:00:00',
    audit() {},
  };
  registerSeed(G);
  return G;
}

test('fixed login accounts are created once with their configured roles', () => {
  const G = fakeEngine();
  const accounts = G.seedData.PROMOTER_LOGINS.accounts;

  assert.equal(G.seedFixedAccounts(), accounts.length);
  assert.equal(G.seedFixedAccounts(), 0);
  assert.equal(G.S.users.length, accounts.length);
  assert.equal(G.S.users.filter((user) => user.role === 'admin').length, accounts.filter((user) => user.role === 'admin').length);
  assert.equal(G.S.users.filter((user) => user.role === 'promoter').length, accounts.filter((user) => user.role === 'promoter').length);
  assert.ok(G.S.users.every((user) => user.email === user.email.toLowerCase()));
});

test('provided shops are grouped by ID and imported only once', () => {
  const G = fakeEngine();
  G.seedFixedAccounts();
  const rows = G.seedData.PROVIDED_SHOPS.shops;
  const uniqueShopIds = new Set(rows.map((shop) => shop.shop_id.toUpperCase()));

  assert.equal(G.addProvidedShops(), uniqueShopIds.size);
  assert.equal(G.addProvidedShops(), 0);
  assert.equal(G.S.shops.length, uniqueShopIds.size);
  assert.equal(G.S.shops.reduce((sum, shop) => sum + shop.promoter_ids.length, 0), rows.length);
  assert.equal(G.S.shops.find((shop) => shop.shop_id === 'PK412914').promoter_ids.length, 2);
  assert.equal(G.S.gifts.length, 0);
  assert.equal(G.S.inv.length, 0);
});
