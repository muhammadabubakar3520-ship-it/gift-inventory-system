'use strict';
const { model } = require('mongoose');
const { schema, ts } = require('./_base');

const CitySchema = schema({
  city_name: { type: String, required: true, maxlength: 80 },
  created_at: ts,
}, { collection: 'cities' });
CitySchema.index({ city_name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = model('City', CitySchema);
