import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import { API } from '../api'

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
    const sock = io(API, { transports: ['polling', 'websocket'] })

    sock.on('connect', () => { setWsStatus('live'); bump() })
    sock.on('disconnect', () => setWsStatus('reconnecting'))
    sock.on('connect_error', () => setWsStatus('offline'))
    sock.on('rfid_update', bump)

    const fallback = setInterval(bump, 1000)

    return () => { sock.disconnect(); clearInterval(fallback) }
  }, [])

  return { wsStatus, tick }
}
