'use strict';
// Thin wrapper so services can emit Socket.IO events without importing the server.
let io = null;
module.exports = {
  init(instance) { io = instance; },
  emit(event, payload) { if (io) io.emit(event, payload); },
  toUser(userId, event, payload) { if (io) io.to(`user:${userId}`).emit(event, payload); },
};
