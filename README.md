# 🔔 Smart Notification System

A highly resilient, real-time notification engine built with **React (Vite)** and **Python (FastAPI)**. 

Designed to handle continuous WebSocket connections, intelligent connection drops, offline queuing, and notification grouping—all critical components of modern scalable notification architectures.

---

## 🏗️ High-Level Architecture

The system is designed around a bidirectional, real-time communication model with an HTTP fallback layer, ensuring notifications are never lost regardless of the user's network state.

### 1. The Real-Time Layer (WebSockets)
We maintain a persistent `wss://` connection between the client and the FastAPI backend. 
- **Fan-Out Delivery:** The backend `WSManager` holds a `Dict[str, List[WebSocket]]`. This allows a single user to have multiple tabs/devices open simultaneously. When a notification is triggered, it fans out to *all* active sockets for that user.
- **Connection Resilience:** Load balancers and network drops frequently kill idle WebSockets. The frontend implements a custom `useWebSocket` hook with an **Exponential Backoff Reconnection** strategy (1.5s → 30s max, up to 10 attempts), distinguishing between intentional client disconnects and unexpected drops.

### 2. The Persistence & Queuing Layer
Rather than dropping messages for offline users, the backend implements an intelligent in-memory `NotificationStore`.
- **Missed Queue:** If a notification is triggered for a user with `len(sockets) == 0`, it routes to a `missed_queue`. The moment that user's WebSocket connects, the backend enforces a 500ms stabilization delay, then flushes the entire missed queue to the client.
- **Smart Grouping:** To prevent UX spam (e.g., getting graded 5 times in a row), the store searches for an existing *unread* notification of the exact same type. If found, it increments a `grouped_count` badge and bumps the timestamp, rather than pushing a new row.

### 3. The Transport Layer (REST + CORS)
Initial historical fetches and state mutations (Mark as Read, Dismiss, Clear All) happen over standard HTTP. 
FastAPI's `CORSMiddleware` handles cross-origin requests securely, terminating TLS at the load balancer level via Render.

---

## 🛠️ Technology Stack

### Backend
- **Framework**: `FastAPI` (Chosen for native `async`/`await` support, crucial for high-concurrency WebSocket handling).
- **Server**: `Uvicorn` (ASGI server).
- **Data Validation**: `Pydantic` (Strict type enforcement on incoming payloads).
- **Hosting**: `Render`

### Frontend
- **Framework**: `React 18` + `Vite` (Lightning-fast HMR and optimized production bundles).
- **Styling**: Vanilla CSS (Zero-dependency, utilizing CSS Variables for a dynamic Dark Mode design system).
- **APIs**: Native `WebSocket` API, `IntersectionObserver` (for auto-read visibility detection), `AudioContext` (for low-latency notification chimes).
- **Hosting**: `Vercel`

---

## ✨ Key Features & UX Polish

1. **Multi-Tab Safety**: WebSocket Manager stores lists of connections per user; actions in one tab sync instantly.
2. **Auto-Read on Visible**: Uses `IntersectionObserver`. If an unread notification enters the viewport for >2 seconds, it automatically fires a `PATCH` request to mark itself as read.
3. **Priority Escalation**: Notifications have `low`, `normal`, or `urgent` priorities. Urgent items receive a pulsing red UI indicator. If a normal notification is grouped with a new urgent one, the entire group escalates to urgent.
4. **Soft-Delete (Dismiss)**: Users can dismiss items from their inbox without affecting the backend's historical integrity (`dismissed: bool` flag).
5. **Dynamic User Management**: A pure UI implementation demonstrating how new entities can be injected into the `NotificationStore` on the fly.
6. **Admin Broadcast**: Simulates an admin panel pushing `target_user_id: *` events using `asyncio.gather` for concurrent delivery.

---

## 🚀 Running Locally

### Prerequisites
- Python 3.10+
- Node.js 18+

### 1. Start the Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
> **Tip:** FastAPI automatically generates interactive OpenAPI documentation. While the backend is running, visit `http://localhost:8000/docs` to test the REST endpoints.

### 2. Start the Frontend
Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```

The app will start at `http://localhost:3000`. 
Open two different browser windows side-by-side. Select `user_a` in one and `user_b` in the other to watch the real-time bidirectional flow in action!
