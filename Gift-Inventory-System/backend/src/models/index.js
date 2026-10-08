'use strict';
/** All Mongoose models. `collections` maps the app's data sets to their model. */
const User = require('./User');
const City = require('./City');
const Market = require('./Market');
const Shop = require('./Shop');
const Gift = require('./Gift');
const ShopInventory = require('./ShopInventory');
const Transaction = require('./Transaction');
const InventoryMovement = require('./InventoryMovement');
const AuditLog = require('./AuditLog');
const Brand = require('./Brand');
const PhoneModel = require('./PhoneModel');
const Counter = require('./Counter');
const Setting = require('./Setting');
const StoredFile = require('./StoredFile');
const WriteLock = require('./WriteLock');

/** data set (as used by the controllers) → model */
const collections = {
  users: User, cities: City, markets: Market, brands: Brand, models: PhoneModel, gifts: Gift, shops: Shop,
  inv: ShopInventory, txns: Transaction, moves: InventoryMovement, audit: AuditLog,
};

module.exports = { User, City, Market, Shop, Gift, ShopInventory, Transaction, InventoryMovement, AuditLog, Brand, PhoneModel, Counter, Setting, StoredFile, WriteLock, collections };
