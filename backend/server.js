const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------------- In-memory data ----------------
const catalog = [
  { id: 1, name: 'Wireless Headphones', price: 49.99 },
  { id: 2, name: 'Smart Watch', price: 89.99 },
  { id: 3, name: 'USB-C Charger', price: 19.99 },
  { id: 4, name: 'Bluetooth Speaker', price: 39.99 },
];
let orders = [];
let nextId = 1001;
const STATUSES = ['Placed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];

// ---------------- SSE (/events) ----------------
let sseClients = [];
function sendAlert(type, message) {
  const data = JSON.stringify({ type, message, time: new Date().toISOString() });
  sseClients.forEach((res) => res.write(`data: ${data}\n\n`));
}
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'info', message: 'Connected to system alerts', time: new Date().toISOString() })}\n\n`);
  sseClients.push(res);
  req.on('close', () => { sseClients = sseClients.filter((c) => c !== res); });
});
// periodic heartbeat alert
setInterval(() => sendAlert('system', `Server healthy · ${orders.length} orders · ${io.engine.clientsCount} live sockets`), 30000);

// ---------------- REST (/api/v1) ----------------
app.get('/', (req, res) => res.json({ status: 'ok', endpoints: ['/api/v1/catalog', '/api/v1/orders', '/rpc', '/events'] }));
app.get('/api/v1/catalog', (req, res) => res.json(catalog));
app.get('/api/v1/orders', (req, res) => res.json(orders));
app.get('/api/v1/orders/:id', (req, res) => {
  const o = orders.find((x) => x.id === +req.params.id);
  o ? res.json(o) : res.status(404).json({ error: 'Order not found' });
});
app.post('/api/v1/orders', (req, res) => {
  const { customer, productId, quantity = 1 } = req.body;
  const product = catalog.find((p) => p.id === +productId);
  if (!customer || !product) return res.status(400).json({ error: 'customer and valid productId required' });
  const order = {
    id: nextId++, customer, product: product.name, quantity: +quantity,
    total: +(product.price * quantity).toFixed(2), status: 'Placed', createdAt: new Date().toISOString(),
  };
  orders.push(order);
  io.emit('order:created', order);
  sendAlert('order', `New order #${order.id} by ${customer}`);
  res.status(201).json(order);
});
app.patch('/api/v1/orders/:id', (req, res) => {
  const o = orders.find((x) => x.id === +req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (req.body.status && !STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  Object.assign(o, req.body.status ? { status: req.body.status } : {});
  io.to(`order:${o.id}`).emit('order:status', o);
  io.emit('order:updated', o);
  res.json(o);
});
app.delete('/api/v1/orders/:id', (req, res) => {
  const before = orders.length;
  orders = orders.filter((x) => x.id !== +req.params.id);
  before === orders.length ? res.status(404).json({ error: 'Order not found' }) : res.status(204).end();
});

// ---------------- JSON-RPC 2.0 (/rpc) ----------------
const rpcMethods = {
  cancelOrder({ orderId }) {
    const o = orders.find((x) => x.id === +orderId);
    if (!o) throw { code: -32001, message: 'Order not found' };
    if (o.status === 'Delivered') throw { code: -32002, message: 'Delivered orders cannot be cancelled' };
    o.status = 'Cancelled';
    io.to(`order:${o.id}`).emit('order:status', o);
    io.emit('order:updated', o);
    sendAlert('warning', `Order #${o.id} was cancelled`);
    return o;
  },
  advanceOrder({ orderId }) {
    const o = orders.find((x) => x.id === +orderId);
    if (!o) throw { code: -32001, message: 'Order not found' };
    const i = STATUSES.indexOf(o.status);
    if (i < 0 || i === STATUSES.length - 1) throw { code: -32002, message: `Cannot advance from ${o.status}` };
    o.status = STATUSES[i + 1];
    io.to(`order:${o.id}`).emit('order:status', o);
    io.emit('order:updated', o);
    if (o.status === 'Delivered') sendAlert('success', `Order #${o.id} delivered`);
    return o;
  },
  getOrderStatus({ orderId }) {
    const o = orders.find((x) => x.id === +orderId);
    if (!o) throw { code: -32001, message: 'Order not found' };
    return { id: o.id, status: o.status };
  },
  broadcastAlert({ message }) {
    sendAlert('admin', message);
    return { sent: true };
  },
};
function handleRpc(req) {
  const id = req && req.id !== undefined ? req.id : null;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string')
    return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id };
  const fn = rpcMethods[req.method];
  if (!fn) return { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id };
  try {
    return { jsonrpc: '2.0', result: fn(req.params || {}), id };
  } catch (e) {
    return { jsonrpc: '2.0', error: { code: e.code || -32603, message: e.message || 'Internal error' }, id };
  }
}
app.post('/rpc', (req, res) => {
  const body = req.body;
  if (Array.isArray(body)) return res.json(body.map(handleRpc));
  res.json(handleRpc(body));
});

// ---------------- WebSockets (Socket.io) ----------------
io.on('connection', (socket) => {
  // Track a specific order's live status
  socket.on('order:track', (orderId) => {
    socket.join(`order:${orderId}`);
    const o = orders.find((x) => x.id === +orderId);
    if (o) socket.emit('order:status', o);
  });

  // 1-on-1 support chat: room = support:<orderId>
  socket.on('chat:join', ({ orderId, role, name }) => {
    const room = `support:${orderId}`;
    socket.data = { room, role, name };
    socket.join(room);
    socket.to(room).emit('chat:system', `${name} (${role}) joined the chat`);
    if (role === 'customer') sendAlert('support', `${name} needs support for order #${orderId}`);
  });
  socket.on('chat:message', (text) => {
    const { room, role, name } = socket.data || {};
    if (!room || !text) return;
    io.to(room).emit('chat:message', { name, role, text, time: new Date().toISOString() });
  });
  socket.on('chat:typing', () => {
    const { room, name } = socket.data || {};
    if (room) socket.to(room).emit('chat:typing', name);
  });
  socket.on('disconnect', () => {
    const { room, role, name } = socket.data || {};
    if (room) socket.to(room).emit('chat:system', `${name} (${role}) left the chat`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
