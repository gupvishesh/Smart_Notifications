import { useState, useCallback, useEffect, useRef } from 'react'
import { useWebSocket } from './hooks/useWebSocket.js'
import NotificationBell from './components/NotificationBell.jsx'
import NotificationInbox from './components/NotificationInbox.jsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/** Fetch a JWT for the given userId from POST /auth/token. */
async function fetchAppToken(userId) {
  try {
    const res = await fetch(`${API_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.access_token
  } catch {
    return null
  }
}

const DEFAULT_USERS = ['Alex', 'Blake', 'Casey', 'Admin']

const NOTIFICATION_TYPES = [
  { type: 'assignment_update', label: 'Send Assignment Update', icon: '📄', colorClass: 'blue' },
  { type: 'message',           label: 'Send Message',           icon: '💬', colorClass: 'purple' },
  { type: 'grade_posted',      label: 'Send Grade Posted',      icon: '🎓', colorClass: 'green' },
]

const PRIORITIES = ['low', 'normal', 'urgent']

// ── AudioContext beep ────────────────────────────────────────────────────────
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    gain.gain.setValueAtTime(0.1, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch (_) {}
}

// ── Toast component ──────────────────────────────────────────────────────────
function Toast({ toast, onDismiss }) {
  const isUrgent = toast.priority === 'urgent'
  const duration = isUrgent ? 5000 : 3000
  const icons = { assignment_update: '📄', message: '💬', grade_posted: '🎓' }

  useEffect(() => {
    const t = setTimeout(onDismiss, duration)
    return () => clearTimeout(t)
  }, [toast.id, onDismiss, duration])

  return (
    <div className={`toast ${isUrgent ? 'urgent-toast' : ''}`} role="alert" aria-live="polite">
      <div className="toast-inner">
        <span className="toast-icon">{icons[toast.type] || '🔔'}</span>
        <div className="toast-body">
          <p className="toast-title">
            {isUrgent && <span className="toast-urgent-dot" />}
            New notification
          </p>
          <p className="toast-msg">{toast.message}</p>
        </div>
        <button className="toast-dismiss" onClick={onDismiss}>✕</button>
      </div>
      <div className="toast-progress">
        <div className="toast-progress-bar" style={{ animationDuration: `${duration}ms` }} />
      </div>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [users, setUsers]                 = useState(DEFAULT_USERS)
  const [selectedUser, setSelectedUser]   = useState('Alex')
  const [targetUser, setTargetUser]       = useState('Alex')
  const [isOnline, setIsOnline]           = useState(true)
  const [notifications, setNotifications] = useState([])
  const [inboxOpen, setInboxOpen]         = useState(false)
  const [toast, setToast]                 = useState(null)
  const [sending, setSending]             = useState(null)
  const [soundEnabled, setSoundEnabled]   = useState(false)
  const [priority, setPriority]           = useState('normal')
  const [newUserInput, setNewUserInput]   = useState('')
  const [addingUser, setAddingUser]       = useState(false)
  const [customMessage, setCustomMessage] = useState('')
  const tokenRef = useRef(null) // cached JWT for the active user

  const isAdmin = selectedUser === 'Admin'

  // ── Tab title badge ──────────────────────────────────────────────────────
  useEffect(() => {
    const unread = notifications.filter((n) => !n.read && !n.dismissed).length
    document.title = unread > 0 ? `(${unread}) Smart Notifications` : 'Smart Notifications'
  }, [notifications])

  // ── Fetch full inbox ─────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async (userId) => {
    if (userId === 'Admin') { setNotifications([]); return }
    try {
      const res = await fetch(`${API_URL}/notifications/${userId}`)
      const data = await res.json()
      setNotifications(data.notifications || [])
    } catch (e) {
      console.error('Failed to fetch notifications:', e)
    }
  }, [])

  useEffect(() => {
    fetchNotifications(selectedUser)
    // Refresh JWT when the active user changes
    if (selectedUser !== 'Admin') {
      fetchAppToken(selectedUser).then((t) => { tokenRef.current = t })
    } else {
      tokenRef.current = null
    }
  }, [selectedUser, fetchNotifications])

  // ── Fetch known users from backend on mount ──────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/users`)
      .then((r) => r.json())
      .then((data) => {
        if (data.users?.length) {
          const merged = Array.from(new Set([...DEFAULT_USERS, ...data.users]))
          setUsers(merged)
        }
      })
      .catch(() => {})
  }, [])

  // ── WebSocket incoming message handler ───────────────────────────────────
  const handleWsMessage = useCallback((notif) => {
    if (soundEnabled) playBeep()
    setNotifications((prev) => {
      const exists = prev.findIndex((n) => n.id === notif.id)
      if (exists !== -1) {
        const updated = [...prev]
        updated[exists] = notif
        return updated
      }
      return [notif, ...prev]
    })
    setToast({ ...notif, _toastId: Date.now() })
  }, [soundEnabled])

  useWebSocket(selectedUser === 'Admin' ? null : selectedUser, isOnline, handleWsMessage)

  // ── Trigger notification ─────────────────────────────────────────────────
  const triggerNotification = async (type) => {
    setSending(type)
    // Ensure we have a valid JWT before sending
    const token = tokenRef.current || (await fetchAppToken(selectedUser))
    if (token) tokenRef.current = token
    try {
      await fetch(`${API_URL}/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          user_id:        selectedUser,
          target_user_id: targetUser,
          type,
          message: customMessage.trim() || buildMessage(type),
          priority,
        }),
      })
    } catch (e) {
      console.error('Failed to send notification:', e)
    } finally {
      setSending(null)
    }
  }

  // ── Admin: Broadcast to all ──────────────────────────────────────────────
  const broadcastToAll = async (type) => {
    setSending(type + '_broadcast')
    const targets = users.filter((u) => u !== 'Admin')
    const token = tokenRef.current || (await fetchAppToken('Admin'))
    if (token) tokenRef.current = token
    try {
      await Promise.all(
        targets.map((u) =>
          fetch(`${API_URL}/notify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              user_id:        'Admin',
              target_user_id: u,
              type,
              message:        customMessage.trim() || buildMessage(type),
              priority,
            }),
          })
        )
      )
    } finally {
      setSending(null)
    }
  }

  // ── Mark single as read ──────────────────────────────────────────────────
  const handleMarkRead = async (id) => {
    try {
      const res = await fetch(`${API_URL}/notifications/${id}/read`, { method: 'PATCH' })
      const data = await res.json()
      setNotifications((prev) => prev.map((n) => (n.id === id ? data.notification : n)))
    } catch (e) { console.error(e) }
  }

  // ── Mark all read ────────────────────────────────────────────────────────
  const handleMarkAllRead = async (userId) => {
    try {
      await fetch(`${API_URL}/notifications/${userId}/read-all`, { method: 'PATCH' })
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch (e) { console.error(e) }
  }

  // ── Dismiss notification ─────────────────────────────────────────────────
  const handleDismiss = async (id) => {
    try {
      await fetch(`${API_URL}/notifications/${id}`, { method: 'DELETE' })
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    } catch (e) { console.error(e) }
  }

  // ── Add custom user ──────────────────────────────────────────────────────
  const handleAddUser = async () => {
    const uid = newUserInput.trim()
    if (!uid || users.includes(uid)) return
    try {
      await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: uid }),
      })
      setUsers((prev) => [...prev, uid])
      setNewUserInput('')
      setAddingUser(false)
    } catch (e) { console.error(e) }
  }

  // ── User switch ──────────────────────────────────────────────────────────
  const handleUserSwitch = (newUser) => {
    setSelectedUser(newUser)
    if (newUser !== 'Admin') setTargetUser(newUser)
    setNotifications([])
    setInboxOpen(false)
  }

  // ── Online/offline toggle ────────────────────────────────────────────────
  const handleToggleOnline = () => {
    const next = !isOnline
    setIsOnline(next)
    if (next) setTimeout(() => fetchNotifications(selectedUser), 600)
  }

  const dismissToast = useCallback(() => setToast(null), [])

  // ── Derive avatar initials ───────────────────────────────────────────────
  const getInitials = (uid) => {
    if (!uid) return '?'
    return uid === 'Admin' ? 'AD' : uid.replace('user_', '').toUpperCase().slice(0, 2)
  }

  return (
    <div className="app-wrapper">

      {/* ── Toast ─────────────────────────────────────────────────────── */}
      <div className="toast-container">
        {toast && <Toast key={toast._toastId} toast={toast} onDismiss={dismissToast} />}
      </div>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="app-header">
        <h1>
          <span className="logo-icon">🔔</span>
          Smart Notifications
        </h1>

        <div className="header-controls">

          {/* Identity Pill */}
          <div className="identity-pill">
            <div className="avatar">{getInitials(selectedUser)}</div>
            <span>As: {selectedUser}</span>
            <span className="chevron">▾</span>
            <select
              id="user-select"
              value={selectedUser}
              onChange={(e) => handleUserSwitch(e.target.value)}
              aria-label="Switch active user"
            >
              {users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Add User */}
          {addingUser ? (
            <div className="add-user-expand">
              <input
                id="new-user-input"
                className="add-user-input"
                type="text"
                placeholder="user_id…"
                value={newUserInput}
                onChange={(e) => setNewUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddUser()}
                autoFocus
              />
              <button className="btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={handleAddUser}>Add</button>
              <button className="btn-secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => { setAddingUser(false); setNewUserInput('') }}>✕</button>
            </div>
          ) : (
            <button
              id="add-user-btn"
              className="header-icon-btn"
              onClick={() => setAddingUser(true)}
              title="Add new user"
              style={{ fontSize: 18, fontWeight: 700 }}
            >
              +
            </button>
          )}

          {/* Sound Toggle */}
          <button
            id="sound-toggle-btn"
            className={`header-icon-btn ${soundEnabled ? 'active' : ''}`}
            onClick={() => setSoundEnabled((s) => !s)}
            title={soundEnabled ? 'Sound on – click to mute' : 'Sound off – click to enable'}
          >
            {soundEnabled ? '🔔' : '🔕'}
          </button>

          {/* Online Status + Network Kill Switch */}
          {!isAdmin && (
            <>
              <div className={`status-pill ${isOnline ? 'online' : 'offline'}`}>
                <span className={`status-dot ${isOnline ? 'pulse' : ''}`} />
                {isOnline ? 'Online' : 'Offline'}
              </div>
              <button
                id="toggle-online-btn"
                className={`network-btn ${isOnline ? 'go-offline' : 'go-online'}`}
                onClick={handleToggleOnline}
              >
                {isOnline ? '⊘ Go Offline' : '↺ Go Online'}
              </button>
            </>
          )}

          {/* Notification Bell */}
          {!isAdmin && (
            <NotificationBell
              notifications={notifications}
              isOpen={inboxOpen}
              onToggle={() => setInboxOpen((o) => !o)}
            />
          )}
        </div>
      </header>

      {/* ── Main Grid ──────────────────────────────────────────────────── */}
      <div className="main-grid">

        {/* ── Left: Trigger Panel ──────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <p className="panel-title">
              {isAdmin ? '📡' : '🎯'} {isAdmin ? 'Admin Broadcast Panel' : 'Trigger Notifications'}
            </p>
            <p className="panel-subtitle">
              {isAdmin
                ? 'Broadcast messages to all connected users simultaneously.'
                : 'Dispatch real-time payloads to connected users.'}
            </p>
          </div>

          <div className="panel-divider" />

          {/* Target User */}
          {!isAdmin && (
            <div className="form-section">
              <label className="form-label">Target User</label>
              <div className="target-select-wrapper">
                <select
                  id="target-user-select"
                  className="target-select"
                  value={targetUser}
                  onChange={(e) => setTargetUser(e.target.value)}
                >
                  {users.filter((u) => u !== 'Admin').map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              {targetUser !== selectedUser && (
                <span className="cross-user-tag">↗ Cross-user Broadcast</span>
              )}
            </div>
          )}

          {/* Priority Segmented Control */}
          <div className="form-section">
            <label className="form-label">Priority Level</label>
            <div className="priority-toggle">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  className={`priority-option ${priority === p ? `active ${p}` : ''}`}
                  onClick={() => setPriority(p)}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Payload Content */}
          <div className="form-section">
            <label className="form-label">Payload Content</label>
            <textarea
              className="payload-textarea"
              placeholder="Type custom notification content or use template…"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
            />
          </div>

          {/* Action Buttons */}
          <div className="form-section">
            <label className="form-label">Actions</label>
            <div className="actions-section">
              {NOTIFICATION_TYPES.map(({ type, label, icon, colorClass }) => (
                <button
                  key={type}
                  id={isAdmin ? `broadcast-${type}` : `trigger-${type}`}
                  className="trigger-btn"
                  onClick={() => isAdmin ? broadcastToAll(type) : triggerNotification(type)}
                  disabled={!!sending}
                >
                  <span className={`btn-icon ${colorClass}`}>{icon}</span>
                  <span className="btn-label">
                    {sending === type || sending === type + '_broadcast'
                      ? (isAdmin ? 'Broadcasting…' : 'Sending…')
                      : (isAdmin ? `Broadcast ${label.replace('Send ', '')}` : label)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* System Intelligence Card */}
          <div className="intel-card">
            <div className="intel-card-title">ⓘ System Intelligence</div>
            {isAdmin ? (
              <ul>
                <li>Broadcasts fire <code>POST /notify</code> for ALL users simultaneously</li>
                <li>Offline users are queued and flushed on reconnect</li>
              </ul>
            ) : (
              <ul>
                <li>Duplicate payloads are automatically grouped</li>
                <li>Online users receive push delivery via WebSocket</li>
                <li>Offline users are queued and flushed on reconnect</li>
                <li>Urgent items trigger a 5-second aggressive toast</li>
                <li>All requests authenticated with JWT (HS256)</li>
              </ul>
            )}
          </div>
        </div>

        {/* ── Right: Inbox ─────────────────────────────────────────────── */}
        {isAdmin ? (
          <div className="inbox-panel">
            <div className="admin-empty">
              <span className="crown">👑</span>
              <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Admin has no inbox.</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Switch to a user account to view their notifications.</p>
            </div>
          </div>
        ) : (
          <NotificationInbox
            notifications={notifications}
            userId={selectedUser}
            onMarkRead={handleMarkRead}
            onDismiss={handleDismiss}
            onMarkAllRead={handleMarkAllRead}
          />
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildMessage(type) {
  const messages = {
    assignment_update: 'Your assignment has been updated. Please review the changes.',
    message:           'You have received a new message from your instructor.',
    grade_posted:      'A new grade has been posted for your recent submission.',
  }
  return messages[type] || 'You have a new notification.'
}
