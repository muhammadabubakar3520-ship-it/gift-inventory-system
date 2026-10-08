'use strict';
/**
 * Real-time sync with Socket.IO.
 *
 * After every saved change the server sends "data:changed" { v, client, at } to every signed-in
 * screen. The event carries no business data (so nothing leaks between users); screens reload what
 * they show from the REST API. `client` is the X-Client-Id of the screen that made the change, so
 * that screen can ignore its own change. `v` is the data revision stored in MongoDB.
 */
const { Server } = require('socket.io');
const G = require('./engine');

function attachSockets(httpServer, { corsOrigin, store }) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    serveClient: false,
    pingInterval: 25000,
    pingTimeout: 20000,
  });
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      socket.data.claims = G.verifyToken(token);
      next();
    } catch (_) { next(new Error('unauthorized')); }
  });
  io.on('connection', (socket) => {
    socket.join(socket.data.claims.role === 'admin' ? 'admins' : 'promoters');
    socket.emit('hello', { v: store.rev });
  });
  const emitChange = (clientId) => {
    const msg = { v: store.rev, client: clientId || null, at: new Date().toISOString() };
    io.to('admins').to('promoters').emit('data:changed', msg);
  };
  return { io, emitChange };
}

module.exports = { attachSockets };
