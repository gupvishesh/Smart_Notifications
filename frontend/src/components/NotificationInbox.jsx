import { useState } from 'react'
import NotificationItem from './NotificationItem.jsx'

const FILTERS = ['All', 'Unread', 'Assignment', 'Message', 'Grade']

const TYPE_MAP = {
  Assignment: 'assignment_update',
  Message:    'message',
  Grade:      'grade_posted',
}

/**
 * NotificationInbox — pill tab filters, mark-all-read, scrollable grouped list.
 */
export default function NotificationInbox({ notifications, userId, onMarkRead, onDismiss, onMarkAllRead }) {
  const [activeFilter, setActiveFilter] = useState('All')

  const filtered = notifications.filter((n) => {
    if (activeFilter === 'Unread')      return !n.read
    if (activeFilter in TYPE_MAP)       return n.type === TYPE_MAP[activeFilter]
    return true // 'All'
  })

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <div className="inbox-panel">

      {/* Header */}
      <div className="inbox-header">
        <div className="inbox-header-left">
          <h2>Inbox</h2>
          <span className="inbox-count">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : '0 unread notifications'}
          </span>
        </div>
        {unreadCount > 0 && (
          <button
            className="mark-all-btn"
            onClick={() => onMarkAllRead(userId)}
            title="Mark all as read"
            id="mark-all-read-btn"
          >
            ✓ Mark all read
          </button>
        )}
      </div>

      {/* Filter Pill Tabs */}
      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`filter-tab ${activeFilter === f ? 'active' : ''}`}
            onClick={() => setActiveFilter(f)}
            id={`filter-tab-${f.toLowerCase()}`}
          >
            {f}
            {f === 'Unread' && unreadCount > 0 && (
              <span className="tab-count">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="inbox-empty">
          <div className="empty-icon">📭</div>
          <p>{activeFilter === 'All' ? 'No notifications yet' : `No ${activeFilter.toLowerCase()} notifications`}</p>
        </div>
      ) : (
        <ul className="inbox-list">
          {filtered.map((notif) => (
            <NotificationItem
              key={notif.id}
              notification={notif}
              onMarkRead={onMarkRead}
              onDismiss={onDismiss}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
