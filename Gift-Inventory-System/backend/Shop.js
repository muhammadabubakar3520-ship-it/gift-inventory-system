'use strict';
const { model } = require('mongoose');
const { schema, link, ts, status, ref } = require('./_base');

/** A retail shop. shop_id is the Shop ID printed in its QR code (e.g. PK413451). */
const ShopSchema = schema({
  shop_id: { type: String, required: true, maxlength: 20 },
  shop_name: { type: String, required: true, maxlength: 150 },
  city_id: { ...ref('City'), required: true },
  market_id: { ...ref('Market'), required: true },
  address: { type: String, default: undefined, maxlength: 300 },
  owner_name: { type: String, default: undefined },
  contact: { type: String, default: undefined },
  promoter_id: ref('User'),
  status,
  qr_generated_at: ts,
  qr_version: { type: Number, min: 0 },
  created_at: ts,
  updated_at: ts,
}, { collection: 'shops' });
ShopSchema.index({ shop_id: 1 }, { unique: true });
ShopSchema.index({ city_id: 1 });
ShopSchema.index({ market_id: 1 });
ShopSchema.index({ promoter_id: 1 });
link(ShopSchema, 'city', 'City', 'city_id');
link(ShopSchema, 'market', 'Market', 'market_id');
link(ShopSchema, 'promoter', 'User', 'promoter_id');

module.exports = model('Shop', ShopSchema);
