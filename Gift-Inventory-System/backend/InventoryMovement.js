'use strict';
const { model } = require('mongoose');
const { schema, link, ts, ref } = require('./_base');

/** Every change to a shop's allocated stock (allocation or manual adjustment). */
const InventoryMovementSchema = schema({
  shop_id: { ...ref('Shop'), required: true },
  gift_id: { ...ref('Gift'), required: true },
  type: { type: String, enum: ['allocation', 'adjustment_in', 'adjustment_out'], required: true },
  quantity: { type: Number, required: true },
  before_qty: { type: Number, required: true },
  after_qty: { type: Number, required: true },
  reason: { type: String, default: undefined },
  user_id: ref('User'),
  created_at: ts,
}, { collection: 'inventory_movements' });
InventoryMovementSchema.index({ shop_id: 1 });
InventoryMovementSchema.index({ gift_id: 1 });
InventoryMovementSchema.index({ created_at: -1 });
link(InventoryMovementSchema, 'shop', 'Shop', 'shop_id');
link(InventoryMovementSchema, 'gift', 'Gift', 'gift_id');
link(InventoryMovementSchema, 'user', 'User', 'user_id');

module.exports = model('InventoryMovement', InventoryMovementSchema);
