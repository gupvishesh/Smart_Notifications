import { useEffect, useRef } from 'react'

/**
 * Maps notification type to a readable label + icon.
 */
const TYPE_META = {
  assignment_update: { label: 'Assignment Update', icon: '📝' },
  message:           { label: 'New Message',       icon: '💬' },
  grade_posted:      { label: 'Grade Posted',      icon: '🎓' },
}

const PRIORITY_CLASS = {
  urgent: 'priority-urgent',
  normal: 'priority-normal',
  low:    'priority-low',
}

function formatTime(isoString) {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1)   return 'Just now'
  if (diffMins < 60)  return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

/**
 * NotificationItem — single inbox row.
 * Features: priority border, grouped ×N badge, dismiss button, auto-read on visible.
 */
export default function NotificationItem({ notification, onMarkRead, onDismiss }) {
  const { id, type, message, timestamp, read, grouped_count, priority } = notification
  const meta = TYPE_META[type] || { label: type, icon: '🔔' }
  const itemRef = useRef(null)
  const timerRef = useRef(null)

  // Auto-read on visible for >2s using Intersection Observer
  useEffect(() => {
    if (read) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timerRef.current = setTimeout(() => onMarkRead(id), 2000)
        } else {
          clearTimeout(timerRef.current)
        }
      },
      { threshold: 0.8 }
    )

    if (itemRef.current) observer.observe(itemRef.current)
    return () => {
      observer.disconnect()
      clearTimeout(timerRef.current)
    }
  }, [id, read, onMarkRead])

  return (
    <li
      ref={itemRef}
      className={`notif-item ${read ? '' : 'unread'} ${PRIORITY_CLASS[priority] || ''}`}
    >
      <div className="notif-icon">{meta.icon}</div>

      <div className="notif-body">
        <div className="notif-type-row">
          <span className="notif-type">{meta.label}</span>
          {grouped_count > 1 && (
            <span className="notif-badge">×{grouped_count}</span>
          )}
          {priority === 'urgent' && (
            <span className="priority-tag urgent">🔴 Urgent</span>
          )}
          {priority === 'low' && (
            <span className="priority-tag low">Low</span>
          )}
        </div>
        <p className="notif-message">{message}</p>
        <p className="notif-time">{formatTime(timestamp)}</p>
      </div>

      <div className="notif-actions">
        {!read && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => onMarkRead(id)}
            title="Mark as read"
          >
            ✓ Read
          </button>
        )}
        <button
          className="btn-dismiss btn-sm"
          onClick={() => onDismiss(id)}
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </li>
  )
}
