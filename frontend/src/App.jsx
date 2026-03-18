import { useState, useCallback, useEffect, useRef } from 'react'
import { useWebSocket } from './hooks/useWebSocket.js'
import NotificationBell from './components/NotificationBell.jsx'
import NotificationInbox from './components/NotificationInbox.jsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const DEFAULT_USERS = ['user_a', 'user_b', 'user_c', 'Admin']

const NOTIFICATION_TYPES = [
  { type: 'assignment_update', label: 'Send Assignment Update', icon: '📝' },
  { type: 'message',           label: 'Send Message',           icon: '💬' },
  { type: 'grade_posted',      label: 'Send Grade Posted',      icon: '🎓' },
]

const PRIORITIES = ['normal', 'urgent', 'low']

// ── AudioContext beep ────────────────────────────────────────────────────
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

// ── Toast component ──────────────────────────────────────────────────────
function Toast({ toast, onDone }) {
  const timerRef = useRef(null)
  useEffect(() => {
    timerRef.current = setTimeout(onDone, 3000)
    return () => clearTimeout(timerRef.current)
  }, [toast.id, onDone])

  const icons = { assignment_update: '📝', message: '💬', grade_posted: '🎓' }
  const urgentStyle = toast.priority === 'urgent'
    ? { borderColor: 'var(--danger)', boxShadow: '0 0 0 1px rgba(239,68,68,0.3)' }
    : {}

  return (
    <div className="toast" role="alert" aria-live="polite" style={urgentStyle}>
      <span className="toast-icon">{icons[toast.type] || '🔔'}</span>
      <div className="toast-body">
        <p className="toast-title">
          {toast.priority === 'urgent' && '🔴 '}New notification
        </p>
        <p className="toast-msg">{toast.message}</p>
      </div>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────
export default function App() {
  const [users, setUsers]                       = useState(DEFAULT_USERS)
  const [selectedUser, setSelectedUser]         = useState('user_a')
  const [targetUser,   setTargetUser]           = useState('user_a')
  const [isOnline,     setIsOnline]             = useState(true)
  const [notifications, setNotifications]       = useState([])
  const [inboxOpen,    setInboxOpen]            = useState(false)
  const [toast,        setToast]                = useState(null)
  const [sending,      setSending]              = useState(null)
  const [soundEnabled, setSoundEnabled]         = useState(false)
  const [priority,     setPriority]             = useState('normal')
  const [newUserInput, setNewUserInput]         = useState('')
  const [addingUser,   setAddingUser]           = useState(false)

  const isAdmin = selectedUser === 'Admin'

  // ── Tab title badge ───────────────────────────────────────────────────
  useEffect(() => {
    const unread = notifications.filter((n) => !n.read && !n.dismissed).length
    document.title = unread > 0 ? `(${unread}) Smart Notifications` : 'Smart Notifications'
  }, [notifications])

  // ── Fetch full inbox ──────────────────────────────────────────────────
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
  }, [selectedUser, fetchNotifications])

  // ── Fetch known users from backend on mount ───────────────────────────
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

  // ── WebSocket incoming message handler ────────────────────────────────
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

  // ── Trigger notification ──────────────────────────────────────────────
  const triggerNotification = async (type) => {
    setSending(type)
    try {
      await fetch(`${API_URL}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:        selectedUser,
          target_user_id: targetUser,
          type,
          message: buildMessage(type),
          priority,
        }),
      })
    } catch (e) {
      console.error('Failed to send notification:', e)
    } finally {
      setSending(null)
    }
  }

  // ── Admin: Broadcast to all users ─────────────────────────────────────
  const broadcastToAll = async (type) => {
    setSending(type + '_broadcast')
    const targets = users.filter((u) => u !== 'Admin')
    try {
      await Promise.all(
        targets.map((u) =>
          fetch(`${API_URL}/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id:        'Admin',
              target_user_id: u,
              type,
              message: buildMessage(type),
              priority,
            }),
          })
        )
      )
    } finally {
      setSending(null)
    }
  }

  // ── Mark single as read ───────────────────────────────────────────────
  const handleMarkRead = async (id) => {
    try {
      const res = await fetch(`${API_URL}/notifications/${id}/read`, { method: 'PATCH' })
      const data = await res.json()
      setNotifications((prev) => prev.map((n) => (n.id === id ? data.notification : n)))
    } catch (e) { console.error(e) }
  }

  // ── Mark all read ─────────────────────────────────────────────────────
  const handleMarkAllRead = async (userId) => {
    try {
      await fetch(`${API_URL}/notifications/${userId}/read-all`, { method: 'PATCH' })
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch (e) { console.error(e) }
  }

  // ── Dismiss notification ──────────────────────────────────────────────
  const handleDismiss = async (id) => {
    try {
      await fetch(`${API_URL}/notifications/${id}`, { method: 'DELETE' })
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    } catch (e) { console.error(e) }
  }

  // ── Add custom user ───────────────────────────────────────────────────
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

  // ── User switch ───────────────────────────────────────────────────────
  const handleUserSwitch = (newUser) => {
    setSelectedUser(newUser)
    if (newUser !== 'Admin') setTargetUser(newUser)
    setNotifications([])
    setInboxOpen(false)
  }

  // ── Online/offline toggle ─────────────────────────────────────────────
  const handleToggleOnline = () => {
    const next = !isOnline
    setIsOnline(next)
    if (next) setTimeout(() => fetchNotifications(selectedUser), 600)
  }

  const dismissToast = useCallback(() => setToast(null), [])

  return (
    <div className="app-wrapper">
      {toast && <Toast key={toast._toastId} toast={toast} onDone={dismissToast} />}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="app-header">
        <h1>🔔 <span>Smart</span> Notifications</h1>

        <div className="header-controls">
          {/* Logged-in user selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>As:</span>
            <select
              id="user-select"
              value={selectedUser}
              onChange={(e) => handleUserSwitch(e.target.value)}
            >
              {users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Add user button */}
          {addingUser ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                id="new-user-input"
                type="text"
                placeholder="user_id"
                value={newUserInput}
                onChange={(e) => setNewUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddUser()}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', borderRadius: 6, padding: '6px 10px',
                  fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 110,
                }}
                autoFocus
              />
              <button className="btn-primary btn-sm" onClick={handleAddUser}>Add</button>
              <button className="btn-secondary btn-sm" onClick={() => { setAddingUser(false); setNewUserInput('') }}>✕</button>
            </div>
          ) : (
            <button className="btn-secondary btn-sm" id="add-user-btn" onClick={() => setAddingUser(true)}>+ User</button>
          )}

          {/* Sound toggle */}
          <button
            className={soundEnabled ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setSoundEnabled((s) => !s)}
            title={soundEnabled ? 'Sound on' : 'Sound off'}
            id="sound-toggle-btn"
          >
            {soundEnabled ? '🔔' : '🔕'}
          </button>

          {/* Online/offline */}
          {!isAdmin && (
            <>
              <div className={`status-badge ${isOnline ? 'online' : 'offline'}`}>
                <span className={`status-dot ${isOnline ? 'pulse' : ''}`} />
                {isOnline ? 'Online' : 'Offline'}
              </div>
              <button
                id="toggle-online-btn"
                className={isOnline ? 'btn-danger btn-sm' : 'btn-success btn-sm'}
                onClick={handleToggleOnline}
              >
                {isOnline ? '⊘ Go Offline' : '↺ Go Online'}
              </button>
            </>
          )}

          {/* Bell (hidden for Admin) */}
          {!isAdmin && (
            <NotificationBell
              notifications={notifications}
              isOpen={inboxOpen}
              onToggle={() => setInboxOpen((o) => !o)}
            />
          )}
        </div>
      </header>

      {/* ── Main grid ───────────────────────────────────────────────── */}
      <div className="main-grid">

        {/* ── Left: Trigger Panel ─────────────────────────────────── */}
        <div className="panel">
          <p className="panel-title">
            {isAdmin ? '📡 Admin Broadcast Panel' : 'Trigger Notifications'}
          </p>

          <div className="trigger-row">
            {/* Target user (non-admin) */}
            {!isAdmin && (
              <div className="trigger-meta">
                <span className="target-label">Send to:</span>
                <select
                  id="target-user-select"
                  value={targetUser}
                  onChange={(e) => setTargetUser(e.target.value)}
                >
                  {users.filter((u) => u !== 'Admin').map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                {targetUser !== selectedUser && (
                  <span style={{ fontSize: 11, color: 'var(--accent-hover)' }}>
                    Cross-user ↗
                  </span>
                )}
              </div>
            )}

            {/* Priority selector */}
            <div className="trigger-meta">
              <span className="target-label">Priority:</span>
              <select
                id="priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Trigger / Broadcast buttons */}
            <div className="trigger-buttons">
              {NOTIFICATION_TYPES.map(({ type, label, icon }) => (
                <button
                  key={type}
                  id={isAdmin ? `broadcast-${type}` : `trigger-${type}`}
                  className="btn-primary trigger-btn"
                  onClick={() => isAdmin ? broadcastToAll(type) : triggerNotification(type)}
                  disabled={!!sending}
                >
                  <span className="icon">{icon}</span>
                  {sending === type || sending === type + '_broadcast'
                    ? (isAdmin ? 'Broadcasting…' : 'Sending…')
                    : (isAdmin ? `Broadcast ${label.replace('Send ', '')}` : label)}
                </button>
              ))}
            </div>
          </div>

          {/* Info card */}
          <div style={{
            marginTop: 20, padding: '12px 14px', background: 'var(--bg-card)',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7,
          }}>
            {isAdmin ? (
              <>
                <strong style={{ color: 'var(--text-primary)' }}>Admin Panel</strong><br />
                📡 Broadcasts fire <code>POST /notify</code> for ALL users simultaneously
              </>
            ) : (
              <>
                <strong style={{ color: 'var(--text-primary)' }}>How it works</strong><br />
                ✅ Online → pushed instantly over WebSocket<br />
                📦 Offline → queued, delivered on reconnect<br />
                🔗 Same-type unread → grouped (×N badge)<br />
                🔴 Urgent → red border + tag
              </>
            )}
          </div>
        </div>

        {/* ── Right: Inbox ────────────────────────────────────────── */}
        {isAdmin ? (
          <div className="inbox-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>👑</div>
              <p>Admin has no inbox.</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Switch to a user to view their notifications.</p>
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

// ── Helpers ───────────────────────────────────────────────────────────────
function buildMessage(type) {
  const messages = {
    assignment_update: 'Your assignment has been updated. Please review the changes.',
    message:           'You have received a new message from your instructor.',
    grade_posted:      'A new grade has been posted for your recent submission.',
  }
  return messages[type] || 'You have a new notification.'
}
