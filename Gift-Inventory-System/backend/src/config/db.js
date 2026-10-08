'use strict';
/** MongoDB connection (Mongoose). The connection string comes only from MONGODB_URI. */
const mongoose = require('mongoose');
const config = require('./env');

mongoose.set('strictQuery', true);

/** Database name: from the connection string, else MONGODB_DB, else "gift_inventory". */
function dbName() {
  if (config.MONGODB_DB) return config.MONGODB_DB;
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(config.MONGODB_URI);
  return m && m[1] ? undefined : 'gift_inventory';
}

async function connectDB() {
  mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
  await mongoose.connect(config.MONGODB_URI, {
    dbName: dbName(),
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    autoIndex: true, // creates the indexes defined in the models
  });
  const { host, name } = mongoose.connection;
  console.log(`[db] connected to MongoDB (${host}, database "${name}")`); // never prints the password
  return mongoose.connection;
}

/** Is MongoDB reachable right now? */
async function pingDB() {
  if (mongoose.connection.readyState !== 1) return false;
  try { await mongoose.connection.db.admin().command({ ping: 1 }); return true; } catch (_) { return false; }
}

async function disconnectDB() { await mongoose.disconnect(); }

module.exports = { connectDB, pingDB, disconnectDB, mongoose };
