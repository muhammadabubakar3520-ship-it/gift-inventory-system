'use strict';
const { model } = require('mongoose');
const { schema, link, ts, ref } = require('./_base');

const MarketSchema = schema({
  city_id: { ...ref('City'), required: true },
  market_name: { type: String, required: true, maxlength: 80 },
  created_at: ts,
}, { collection: 'markets' });
MarketSchema.index({ city_id: 1, market_name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
link(MarketSchema, 'city', 'City', 'city_id');

module.exports = model('Market', MarketSchema);
