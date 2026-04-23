import { useEffect, useRef } from 'react'

/**
 * Maps notification type to a readable label, icon, and color class.
 */
const TYPE_META = {
  assignment_update: { label: 'Assignment Update', icon: '📄', colorClass: 'blue' },
  message:           { label: 'Message Update',    icon: '💬', colorClass: 'purple' },
  grade_posted:      { label: 'Grade Posted',       icon: '🎓', colorClass: 'green' },
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
 * Features:
 *  - Type-specific left border accent (blue/red/green)
 *  - Priority-based urgent rose background and tag
 *  - Grouped ×N pill badge
 *  - Auto-read after 2,000ms viewport dwell via IntersectionObserver
 *  - Dismiss button
 */
export default function NotificationItem({ notification, onMarkRead, onDismiss }) {
  const { id, type, message, timestamp, read, grouped_count, priority } = notification
  const meta = TYPE_META[type] || { label: type, icon: '🔔', colorClass: 'blue' }
  const itemRef = useRef(null)
  const timerRef = useRef(null)

  // Auto-read on visible for > 2s using Intersection Observer
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

  const priorityClass = priority === 'urgent' ? 'priority-urgent'
                      : priority === 'low'    ? 'priority-low'
                      : ''

  return (
    <li
      ref={itemRef}
      className={`notif-item ${read ? '' : 'unread'} type-${type} ${priorityClass}`}
    >
      {/* Icon */}
      <div className={`notif-icon-wrap ${meta.colorClass}`}>
        {meta.icon}
      </div>

      {/* Body */}
      <div className="notif-body">
        <div className="notif-type-row">
          <span className="notif-type">{meta.label}</span>

          {grouped_count > 1 && (
            <span className="notif-badge">×{grouped_count}</span>
          )}

          {priority === 'urgent' && (
            <span className="priority-tag urgent">URGENT</span>
          )}

          {priority === 'low' && (
            <span className="priority-tag low">Low</span>
          )}
        </div>

        <p className="notif-message">{message}</p>
        <p className="notif-time">{formatTime(timestamp)}</p>
      </div>

      {/* Actions */}
      <div className="notif-actions">
        {!read && (
          <button
            className="btn-read"
            onClick={() => onMarkRead(id)}
            title="Mark as read"
          >
            ✓ Read
          </button>
        )}
        <button
          className="btn-dismiss"
          onClick={() => onDismiss(id)}
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </li>
  )
}
