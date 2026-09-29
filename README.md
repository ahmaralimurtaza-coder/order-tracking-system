# 📦 Order Tracking & Live Support System

A real-time full-stack web app demonstrating **4 communication protocols** in one project:

| Protocol | Route | Used for |
|---|---|---|
| **REST** | `/api/v1/orders`, `/api/v1/catalog` | Orders & catalog CRUD |
| **WebSockets (Socket.io)** | `/socket.io` | Live order status + 1-on-1 Customer ↔ Agent chat |
| **JSON-RPC 2.0** | `POST /rpc` | Actions: `cancelOrder`, `advanceOrder`, `getOrderStatus`, `broadcastAlert` |
| **Server-Sent Events** | `GET /events` | Live system alerts pushed from server |

**Live Demo**
- Frontend (Netlify/Vercel): `https://YOUR-FRONTEND-URL`
- Backend (Render): `https://YOUR-BACKEND-URL`

**Tech:** Node.js, Express, Socket.io (backend) · HTML/CSS/Vanilla JS, Socket.io client, EventSource (frontend). Data is in-memory.

---

## 📁 Structure
```
backend/   server.js, package.json   → deploy on Render
frontend/  index.html                → deploy on Netlify / Vercel
```

---

## 🔌 REST API

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/api/v1/catalog` | – | List products |
| GET | `/api/v1/orders` | – | List orders |
| GET | `/api/v1/orders/:id` | – | Get one order |
| POST | `/api/v1/orders` | `{ customer, productId, quantity }` | Create order |
| PATCH | `/api/v1/orders/:id` | `{ status }` | Update status |
| DELETE | `/api/v1/orders/:id` | – | Delete order |

Order statuses: `Placed → Packed → Shipped → Out for Delivery → Delivered` (or `Cancelled`).

---

## ⚡ WebSocket Events (Socket.io)

### Client → Server
| Event | Payload | Description |
|---|---|---|
| `order:track` | `orderId` | Join room `order:<id>` to receive live status of that order |
| `chat:join` | `{ orderId, role: 'customer'\|'agent', name }` | Join 1-on-1 support room `support:<orderId>` |
| `chat:message` | `text` | Send message to your support room |
| `chat:typing` | – | Notify the other person you are typing |

### Server → Client
| Event | Payload | Description |
|---|---|---|
| `order:created` | `order` | Broadcast to all when a new order is placed |
| `order:updated` | `order` | Broadcast to all when any order changes |
| `order:status` | `order` | Sent only to clients tracking that order |
| `chat:message` | `{ name, role, text, time }` | New chat message in the room |
| `chat:system` | `string` | Join/leave notices |
| `chat:typing` | `name` | Other user is typing |

**Chat rooms:** Customer and Agent join the same room `support:<orderId>`, so each order gets its own private 1-on-1 conversation.

---

## 🧩 JSON-RPC 2.0 (`POST /rpc`)

```json
// Request
{ "jsonrpc": "2.0", "method": "cancelOrder", "params": { "orderId": 1001 }, "id": 1 }
// Success
{ "jsonrpc": "2.0", "result": { "id": 1001, "status": "Cancelled", ... }, "id": 1 }
// Error
{ "jsonrpc": "2.0", "error": { "code": -32001, "message": "Order not found" }, "id": 1 }
```

| Method | Params | Description |
|---|---|---|
| `cancelOrder` | `{ orderId }` | Cancel an order (not allowed if delivered) |
| `advanceOrder` | `{ orderId }` | Move order to next status (agent action) |
| `getOrderStatus` | `{ orderId }` | Get current status |
| `broadcastAlert` | `{ message }` | Push an admin alert to all SSE clients |

Supports batch requests (array). Standard error codes: `-32600` Invalid Request, `-32601` Method not found, `-32603` Internal error.

---

## 📡 Server-Sent Events (`GET /events`)

```js
const es = new EventSource(`${API}/events`);
es.onmessage = (e) => console.log(JSON.parse(e.data)); // { type, message, time }
```
Alert types: `info`, `order`, `warning`, `success`, `support`, `admin`, `system` (heartbeat every 30s).

---

## 🚀 Setup (Local)

```bash
cd backend
npm install
npm start          # http://localhost:4000
```
Then open `frontend/index.html` in the browser (it auto-uses `localhost:4000` locally).

**Test chat:** open the page in 2 tabs → Tab 1 join as *Customer*, Tab 2 as *Support Agent* with the same Order ID.

---

## ☁️ Deployment

**Backend → Render**
1. New → Web Service → connect this repo
2. Root Directory: `backend` · Build: `npm install` · Start: `npm start`

**Frontend → Netlify / Vercel**
1. Put your Render URL in `frontend/index.html` (the `API` constant)
2. Deploy the `frontend` folder (Netlify: drag & drop, or Vercel: Root Directory = `frontend`)

> Note: Render free tier sleeps after inactivity — the first request may take ~50s.
