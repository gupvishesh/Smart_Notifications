<p align="center">
  <h1 align="center">🔔 Smart Notification System</h1>
  <p align="center">
    A highly resilient, real-time notification engine built with <b>React (Vite)</b> and <b>Python (FastAPI)</b>.
  </p>
</p>

Designed to handle continuous WebSocket connections, intelligent connection drops, offline queuing, and notification grouping—all critical components of modern scalable notification architectures.

---

## 🏗️ High-Level Architecture

The system is designed around a bidirectional, real-time communication model with an HTTP fallback layer, ensuring notifications are never lost regardless of the user's network state.

### 1. The Real-Time Layer (WebSockets)
We maintain a persistent `wss://` connection between the client and the FastAPI backend. 
- **Fan-Out Delivery (Pub/Sub):** The backend incorporates an `asyncio.Queue` based Pub/Sub broker (mirroring Redis). A single user can have multiple tabs open seamlessly, as notifications fan out to all active sockets for that user.
- **Connection Resilience:** Load balancers and network drops frequently kill idle WebSockets. The frontend implements a custom `useWebSocket` hook with **Exponential Backoff Reconnection** (1.5s → 30s max, up to 10 attempts).

### 2. The Persistence & Queuing Layer (SQLite & SQLAlchemy)
Rather than dropping messages for offline users or relying purely on volatile memory:
- **Database Persistence:** Using Async SQLAlchemy and SQLite `notifications.db`, all data survives server restarts. (Seamlessly upgradeable to PostgreSQL).
- **Missed Queue Recovery:** If a notification fires for an offline user, it's flagged as `queued_missed=True` in the DB. The moment the user reconnects, a 500ms stabilization delay happens, followed by a flush of all missed payloads.
- **Smart Grouping:** To prevent UX spam, the database looks for existing *unread* notifications of the exact same type, increments a `grouped_count` badge, and escalates priority if necessary instead of creating noise.

### 3. The Security & Escalation Layer
- **JWT Authentication:** Requests to `POST /notify` and WebSocket connections require a Valid JWT (Bearer header / URL query).
- **Fallback Escalation Loop:** A background `asyncio` loop scans the DB every 60s for `urgent`, unread notifications older than 15 minutes, simulating SLA breaches that necessitate fallback routing (like SMS/Email).

---

## 🛠️ Technology Stack

| Layer | Technologies Used |
|-------|-------------------|
| **Backend Core** | FastAPI, Uvicorn, Python 3.10+ |
| **Data / ORM** | SQLAlchemy (Async), SQLite (`aiosqlite`), Pydantic |
| **Security / Auth** | `python-jose` (JWT Cryptography HS256) |
| **Frontend Core** | React 18, Vite |
| **UI & UX** | Vanilla CSS, IntersectionObserver (Auto-Read), Web Audio API |

---

## ✨ Key Features & UX Polish

1. **Multi-Tab Safety**: The Broker model ensures actions in one tab reflect perfectly across all other instances.
2. **Auto-Read on Visible**: Uses `IntersectionObserver`. Unread items entering the viewport for >2 seconds automatically update the DB as read.
3. **Priority Escalation**: Notifications have `low`, `normal`, or `urgent` priorities. `urgent` items spawn an aggressive pulsing 5-second progress-bar toast. Grouping a normal item into an urgent one escalates the group.
4. **Soft-Delete (Dismiss)**: Pure historical integrity. Users dismiss items, triggering a `dismissed: True` database flag rather than a row deletion.
5. **Cross-User Broadcasts**: An Admin simulated mode (`asyncio.gather`) allows pushing real-time payloads to all connected clients natively.

---

## 🚀 Running Locally

### Prerequisites
- Python 3.10+
- Node.js 18+

### 1. Start the Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
> **Tip:** Visit `http://localhost:8000/docs` to test the auto-generated Swagger UI interactive documentation.

### 2. Start the Frontend
Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```

The app will start at `http://localhost:3000`. 
Open two different browser windows side-by-side. Select `user_a` in one and `user_b` in the other to watch the real-time bidirectional flow in action!


