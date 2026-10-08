'use strict';
const { model } = require('mongoose');
const { schema, ts, status } = require('./_base');

/** Mobile phone brand (Infinix, Tecno, …). */
const BrandSchema = schema({
  brand_code: { type: String, required: true, maxlength: 20 },
  brand_name: { type: String, required: true, maxlength: 60 },
  status,
  created_at: ts,
  updated_at: ts,
}, { collection: 'brands' });
BrandSchema.index({ brand_code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
BrandSchema.index({ brand_name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = model('Brand', BrandSchema);
