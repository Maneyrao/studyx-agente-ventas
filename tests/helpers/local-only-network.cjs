// Explicit opt-in preload for the disposable workflow backend. Block before
// DNS/TCP, including Google ADC and background workers that bypass fetch.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Synchronous Node --require preload must run before any application sockets.
const { Socket } = require('node:net');
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  const host = options && typeof options === 'object'
    ? options.host ?? options.hostname ?? 'localhost'
    : typeof normalized[1] === 'string' ? normalized[1] : 'localhost';
  if (!['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(host)) {
    process.stderr.write(`[local-only-network] blocked host=${host}\n`);
    throw new Error('WORKFLOW_NON_LOCAL_NETWORK_BLOCKED');
  }
  return connect.apply(this, args);
};
