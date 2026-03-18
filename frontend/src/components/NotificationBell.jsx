/**
 * NotificationBell — bell icon with an unread badge.
 * Clicking it toggles the inbox panel open/closed.
 */
export default function NotificationBell({ notifications, isOpen, onToggle }) {
  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <button
      className="bell-btn"
      onClick={onToggle}
      aria-label={`Notifications (${unreadCount} unread)`}
      title="Open notification inbox"
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
