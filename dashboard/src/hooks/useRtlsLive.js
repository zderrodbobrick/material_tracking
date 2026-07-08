import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../api'
import { getSocket } from '../lib/socket'

const BACKUP_POLL_MS = 5000

/**
 * Live RTLS state for the floor plan.
 * Primary: Socket.IO `rtls_update` pushes (instant marker moves).
 * Backup: HTTP poll every 5s in case a socket event is missed.
 */
export function useRtlsLive() {
  const [rtls, setRtls] = useState(null)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const rtlsRef = useRef(null)

  const applyLive = useCallback((res) => {
    rtlsRef.current = res
    setRtls(res)
    setError(null)
    setFetchedAt(new Date())
  }, [])

  useEffect(() => {
    let alive = true
    apiFetch('/api/rtls/health')
      .then(res => { if (alive) setHealth(res) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true

    const fetchLive = () => {
      apiFetch('/api/rtls/live')
        .then(res => { if (alive) applyLive(res) })
        .catch(() => {
          if (!alive) return
          if (!rtlsRef.current) setError('Could not load RTLS data')
        })
    }

    fetchLive()
    const pollId = setInterval(fetchLive, BACKUP_POLL_MS)

    const sock = getSocket()
    const onRtlsUpdate = (data) => {
      if (!alive || !data?.positions) return
      applyLive({
        enabled: rtlsRef.current?.enabled ?? true,
        connected: data.connected ?? rtlsRef.current?.connected ?? false,
        last_message_at: data.ts ?? rtlsRef.current?.last_message_at,
        positions: data.positions,
        zone_presence: rtlsRef.current?.zone_presence ?? [],
        station_name: rtlsRef.current?.station_name,
        confirm_seconds: rtlsRef.current?.confirm_seconds,
      })
    }

    sock.on('rtls_update', onRtlsUpdate)

    return () => {
      alive = false
      clearInterval(pollId)
      sock.off('rtls_update', onRtlsUpdate)
    }
  }, [applyLive])

  return { rtls, health, error, fetchedAt }
}
