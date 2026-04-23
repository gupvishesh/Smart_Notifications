/**
 * NotificationBell — circular icon button with unread badge.
 * Matches the new header icon button design.
 */
export default function NotificationBell({ notifications, isOpen, onToggle }) {
  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <button
      className={`header-icon-btn ${isOpen ? 'active' : ''}`}
      onClick={onToggle}
      aria-label={`Notifications (${unreadCount} unread)`}
      title="Open notification inbox"
      id="notification-bell-btn"
      style={{ fontSize: 17 }}
    >
      🔔
      {unreadCount > 0 && (
        <span key={unreadCount} className="bell-badge">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
