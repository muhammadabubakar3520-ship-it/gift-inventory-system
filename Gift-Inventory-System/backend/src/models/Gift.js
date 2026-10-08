'use strict';
const { model } = require('mongoose');
const { schema, ts, status } = require('./_base');

/** Promotional gift with its central warehouse stock (total_quantity). */
const GiftSchema = schema({
  gift_id: { type: String, required: true, maxlength: 20 },
  gift_name: { type: String, required: true, maxlength: 100 },
  category: { type: String, default: undefined, maxlength: 60 },
  description: { type: String, default: undefined, maxlength: 500 },
  unit: { type: String, required: true, maxlength: 20 },
  total_quantity: { type: Number, required: true, min: 0 },
  image_path: { type: String, default: undefined },
  status,
  created_at: ts,
  updated_at: ts,
}, { collection: 'gifts' });
GiftSchema.index({ gift_id: 1 }, { unique: true });

module.exports = model('Gift', GiftSchema);
