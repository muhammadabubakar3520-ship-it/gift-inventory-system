'use strict';

/**
 * MongoDB connection using Mongoose.
 * The connection string must be provided through MONGODB_URI.
 */

const mongoose = require('mongoose');
const config = require('./env');

mongoose.set('strictQuery', true);

/**
 * Get database name.
 *
 * Priority:
 * 1. MONGODB_DB environment variable
 * 2. Database name from MONGODB_URI
 * 3. "gift_inventory"
 */
function dbName() {
  if (config.MONGODB_DB) {
    return config.MONGODB_DB;
  }

  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(
    config.MONGODB_URI
  );

  return match && match[1] ? undefined : 'gift_inventory';
}

/**
 * Connect to MongoDB Atlas.
 */
async function connectDB() {
  mongoose.connection.on('connected', () => {
    console.log('[db] MongoDB connected');
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[db] MongoDB reconnected');
  });

  await mongoose.connect(config.MONGODB_URI, {
    dbName: dbName(),
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    autoIndex: true
  });

  const { host, name } = mongoose.connection;

  console.log(
    `[db] connected to MongoDB (${host}, database "${name}")`
  );

  return mongoose.connection;
}

/**
 * Check whether MongoDB is reachable.
 */
async function pingDB() {
  if (mongoose.connection.readyState !== 1) {
    return false;
  }

  try {
    await mongoose.connection.db.admin().command({
      ping: 1
    });

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Disconnect from MongoDB.
 */
async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = {
  connectDB,
  pingDB,
  disconnectDB,
  mongoose
};
