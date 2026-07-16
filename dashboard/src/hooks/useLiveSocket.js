import { useState, useEffect } from 'react'
import { getSocket } from '../lib/socket'

/**
 * Single shared Socket.IO connection for the whole app.
 * Returns the connection status and a `tick` counter that increments on every
 * rfid_update event (plus a periodic fallback). Pages re-fetch whenever `tick`
 * changes, so all tabs stay live without each opening their own socket.
 */
export function useLiveSocket() {
  const [wsStatus, setWsStatus] = useState('connecting')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    const sock = getSocket()
    const onConnect = () => { setWsStatus('live'); bump() }
    const onDisconnect = () => setWsStatus('reconnecting')
    const onError = () => setWsStatus('offline')

    sock.on('connect', onConnect)
    sock.on('disconnect', onDisconnect)
    sock.on('connect_error', onError)
    sock.on('rfid_update', bump)

    // Fast fallback so sim DB writes still refresh even if a socket event is missed.
    const fallback = setInterval(bump, 3000)

    if (sock.connected) {
      setWsStatus('live')
      bump()
    }

    return () => {
      sock.off('connect', onConnect)
      sock.off('disconnect', onDisconnect)
      sock.off('connect_error', onError)
      sock.off('rfid_update', bump)
      clearInterval(fallback)
    }
  }, [])

  return { wsStatus, tick }
}
