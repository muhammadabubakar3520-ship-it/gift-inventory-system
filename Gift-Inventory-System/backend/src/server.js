'use strict';
/**
 * Gift Inventory API — start-up.
 *   1. read the settings (.env / Render environment) and check them
 *   2. connect to MongoDB Atlas
 *   3. load the data (an empty database gets the admin account and the starting data)
 *   4. start the REST API (Express) and real-time sync (Socket.IO)
 */
const config = require('./config/env');
process.env.TZ = config.TZ; // business time zone for "today" and daily / monthly reports

const http = require('http');
const { connectDB, disconnectDB } = require('./config/db');
const G = require('./services/engine');
const { MongoStore } = require('./services/store');
const { createApp, corsOrigin } = require('./app');
const { attachSockets } = require('./services/socket');

async function start() {
  const errs = config.validate();
  if (errs.length) {
    console.error('\nThe server cannot start:\n' + errs.map((e) => '  - ' + e).join('\n') + '\n');
    process.exit(1);
  }
  await connectDB();

  G.loadControllers();
  require('./services/seed')(G);
  const store = new MongoStore(G);
  G.useStore(store);
  // first start / upgrades run under the shared write lock (two instances starting together seed only once)
  const r = await G.exclusive(async () => { const h = await store.lock(); try { return await G.initData(store); } finally { await store.unlock(h); } });
  if (r.created) console.log(`[data] new database: admin ${config.ADMIN_EMAIL} created${config.SEED_DATA ? ', starting data loaded' : ''}`);

  const app = createApp({ store });
  const server = http.createServer(app);
  const sockets = attachSockets(server, { corsOrigin, store });
  G.onWrite = (ctx) => sockets.emitChange(ctx && ctx.clientId);

  await new Promise((res) => server.listen(config.PORT, res));
  console.log(`[api] Gift Inventory API on port ${config.PORT} (${config.IS_PROD ? 'production' : 'development'})`);
  console.log(`[api] allowed frontend: ${config.FRONTEND_URLS.join(', ') || '(none)'}${config.ALLOW_VERCEL_PREVIEWS ? ' + *.vercel.app' : ''}`);

  const stop = async (sig) => {
    console.log(`[api] ${sig}: shutting down`);
    sockets.io.close();
    server.close();
    await G.exclusive(() => {}).catch(() => {}); // let the running request finish
    await disconnectDB().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  return { app, server, store, sockets };
}

if (require.main === module) {
  start().catch((e) => {
    console.error('[api] start failed:', e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { start };
