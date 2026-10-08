'use strict';
const { model } = require('mongoose');
const { schema, link, ts, status, ref } = require('./_base');

/** Mobile phone model (SKU) sold in the shops. item_code is the Model ID. */
const PhoneModelSchema = schema({
  item_code: { type: String, required: true, maxlength: 40 },
  model_name: { type: String, required: true, maxlength: 100 },
  brand_id: ref('Brand'),
  status,
  created_at: ts,
  updated_at: ts,
}, { collection: 'phone_models' });
PhoneModelSchema.index({ item_code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
PhoneModelSchema.index({ brand_id: 1 });
link(PhoneModelSchema, 'brand', 'Brand', 'brand_id');

module.exports = model('PhoneModel', PhoneModelSchema);
