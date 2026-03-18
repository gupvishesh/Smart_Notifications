import { useState } from 'react'
import NotificationItem from './NotificationItem.jsx'

const FILTERS = ['All', 'Unread', 'Assignments', 'Messages', 'Grades']

const TYPE_MAP = {
  Assignments: 'assignment_update',
  Messages:    'message',
  Grades:      'grade_posted',
}

/**
 * NotificationInbox — filter tabs, mark-all-read, scrollable grouped list.
 */
export default function NotificationInbox({ notifications, userId, displayName, onMarkRead, onDismiss, onMarkAllRead }) {
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
        <div>
          <h2>Inbox{displayName ? <span className="inbox-subtitle"> · {displayName}</span> : null}</h2>
          <span className="inbox-count">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </span>
        </div>
        {unreadCount > 0 && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => onMarkAllRead(userId)}
            title="Mark all as read"
          >
            ✓✓ Mark all read
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`filter-tab ${activeFilter === f ? 'active' : ''}`}
            onClick={() => setActiveFilter(f)}
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
