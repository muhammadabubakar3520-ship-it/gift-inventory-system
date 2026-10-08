'use strict';
const { Schema, model } = require('mongoose');

/**
 * Number sequences: next record ids (id_shops, id_txns, …) and codes (shop → SHP-0001,
 * txn → TXN-0000001, …). The special counter "__revision" goes up after every saved change; every
 * server instance and every open screen uses it to notice new data.
 */
const CounterSchema = new Schema({
  name: { type: String, required: true, maxlength: 60 },
  value: { type: Number, required: true, default: 0 },
}, { collection: 'counters', timestamps: true, versionKey: false });
CounterSchema.index({ name: 1 }, { unique: true });

module.exports = model('Counter', CounterSchema);
