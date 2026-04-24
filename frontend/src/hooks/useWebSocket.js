import { useEffect, useRef, useCallback } from 'react'

const WS_URL  = import.meta.env.VITE_WS_URL  || 'ws://localhost:8000'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Reconnect config
const RECONNECT_BASE_DELAY_MS = 1500    // first retry after 1.5s
const RECONNECT_MAX_DELAY_MS  = 30000  // cap at 30s
const RECONNECT_MAX_ATTEMPTS  = 10     // give up after 10 tries

/**
 * Fetch a JWT for the given userId from POST /auth/token.
 * Returns the token string, or null on failure.
 */
async function fetchToken(userId) {
  try {
    const res = await fetch(`${API_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`)
    const data = await res.json()
    return data.access_token
  } catch (e) {
    console.error('[WS] Failed to fetch JWT:', e)
    return null
  }
}

/**
 * useWebSocket — connects to /ws/{userId}?token=<jwt>, with:
 *   - JWT token fetched automatically before each connection
 *   - Automatic reconnection on unexpected close (exponential backoff)
 *   - Intentional disconnection when enabled=false or userId changes
 *   - Multi-tab safe (each hook instance is its own socket)
 *   - wss:// in prod via VITE_WS_URL env var (no mixed-content issue)
 */
export function useWebSocket(userId, enabled, onMessage) {
  const socketRef      = useRef(null)
  const onMessageRef   = useRef(onMessage)
  const attemptsRef    = useRef(0)
  const retryTimerRef  = useRef(null)
  const intentionalRef = useRef(false)  // true when WE closed the socket
  const tokenRef       = useRef(null)   // cached JWT

  // Keep callback ref fresh — avoids unnecessary reconnects on re-renders
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  const closeSocket = useCallback((intentional = true) => {
    intentionalRef.current = intentional
    clearRetryTimer()
    if (socketRef.current) {
      socketRef.current.onclose = null  // suppress the onclose handler
      socketRef.current.onerror = null
      socketRef.current.close()
      socketRef.current = null
    }
  }, [])

  const connect = useCallback(async () => {
    if (!userId || !enabled) return

    // Fetch (or reuse cached) JWT
    if (!tokenRef.current) {
      tokenRef.current = await fetchToken(userId)
    }
    if (!tokenRef.current) {
      console.error('[WS] Cannot connect — no valid JWT.')
      return
    }

    const url = `${WS_URL}/ws/${userId}?token=${tokenRef.current}`
    console.log(`[WS] Connecting as ${userId} (attempt ${attemptsRef.current + 1})`)

    const ws = new WebSocket(url)
    socketRef.current = ws
    intentionalRef.current = false

    ws.onopen = () => {
      console.log(`[WS] Connected as ${userId}`)
      attemptsRef.current = 0  // reset backoff counter on successful connection
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        // Silently ignore server heartbeat pings
        if (data?.type === 'ping') return
        onMessageRef.current(data)
      } catch (e) {
        console.error('[WS] Failed to parse message:', e)
      }
    }

    ws.onerror = (err) => {
      console.error('[WS] Socket error:', err)
    }

    ws.onclose = (event) => {
      console.log(`[WS] Closed (code=${event.code}, intentional=${intentionalRef.current})`)
      socketRef.current = null

      // Token may have expired — clear it so we fetch a fresh one on reconnect
      if (event.code === 1008) {
        console.warn('[WS] Closed with policy violation (1008) — refreshing JWT.')
        tokenRef.current = null
      }

      // Only reconnect if the close was NOT intentional and we have attempts left
      if (!intentionalRef.current && attemptsRef.current < RECONNECT_MAX_ATTEMPTS) {
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * Math.pow(1.8, attemptsRef.current),
          RECONNECT_MAX_DELAY_MS
        )
        attemptsRef.current += 1
        console.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${attemptsRef.current})`)
        retryTimerRef.current = setTimeout(connect, delay)
      } else if (attemptsRef.current >= RECONNECT_MAX_ATTEMPTS) {
        console.warn('[WS] Max reconnect attempts reached. Giving up.')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, enabled])

  useEffect(() => {
    if (!enabled || !userId) {
      closeSocket(true)
      return
    }

    // User switched or re-enabling — clear stale token and reconnect
    attemptsRef.current = 0
    tokenRef.current = null
    closeSocket(true)
    connect()

    return () => closeSocket(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, enabled])

  return {
    isConnected: () => socketRef.current?.readyState === WebSocket.OPEN,
  }
}
