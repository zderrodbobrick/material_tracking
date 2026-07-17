import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../api'
import { getSocket } from '../lib/socket'

const BACKUP_POLL_MS = 5000

function mergeZone(prev, zone) {
  if (!zone?.tag_id) return prev
  const base = prev ?? { positions: [], zone_presence: [], connected: true, enabled: true }
  const zone_presence = [...(base.zone_presence ?? [])]
  const idx = zone_presence.findIndex(z => z.tag_id === zone.tag_id)
  if (zone.status === 'out') {
    if (idx >= 0) zone_presence.splice(idx, 1)
  } else if (idx >= 0) {
    zone_presence[idx] = { ...zone_presence[idx], ...zone }
  } else {
    zone_presence.push(zone)
  }
  return { ...base, zone_presence }
}

function zoneOnlyState(res, prev = null) {
  return {
    enabled: res?.enabled ?? prev?.enabled ?? true,
    connected: res?.connected ?? prev?.connected ?? false,
    last_message_at: res?.last_message_at ?? res?.ts ?? prev?.last_message_at,
    positions: [],
    zone_presence: res?.zone_presence ?? prev?.zone_presence ?? [],
    station_name: res?.station_name ?? prev?.station_name,
    confirm_seconds: res?.confirm_seconds ?? prev?.confirm_seconds,
  }
}

/**
 * Live RTLS state for the floor plan.
 * Zone enter/exit only — no live XY position stream (avoids high-frequency re-renders).
 */
export function useRtlsLive() {
  const [rtls, setRtls] = useState(null)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const rtlsRef = useRef(null)

  const applyLive = useCallback((res) => {
    const next = zoneOnlyState(res, rtlsRef.current)
    rtlsRef.current = next
    setRtls(next)
    setError(null)
    setFetchedAt(new Date())
  }, [])

  const applyZone = useCallback((zone) => {
    if (!zone?.tag_id) return
    const next = mergeZone(rtlsRef.current, zone)
    rtlsRef.current = next
    setRtls(next)
    setError(null)
    setFetchedAt(new Date())
  }, [])

  const refresh = useCallback(() => {
    return apiFetch('/api/rtls/live')
      .then(res => { applyLive(res); return res })
      .catch(err => {
        if (!rtlsRef.current) setError('Could not load RTLS data')
        throw err
      })
  }, [applyLive])

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

    const onRtlsZone = (data) => {
      if (!alive || !data?.zone) return
      applyZone(data.zone)
    }

    const onRtlsUpdate = (data) => {
      if (!alive || !data) return
      applyLive({
        enabled: rtlsRef.current?.enabled ?? true,
        connected: data.connected ?? rtlsRef.current?.connected ?? false,
        last_message_at: data.ts ?? rtlsRef.current?.last_message_at,
        zone_presence: data.zone_presence ?? rtlsRef.current?.zone_presence ?? [],
        station_name: rtlsRef.current?.station_name,
        confirm_seconds: rtlsRef.current?.confirm_seconds,
      })
    }

    sock.on('rtls_zone', onRtlsZone)
    sock.on('rtls_update', onRtlsUpdate)

    return () => {
      alive = false
      clearInterval(pollId)
      sock.off('rtls_zone', onRtlsZone)
      sock.off('rtls_update', onRtlsUpdate)
    }
  }, [applyLive, applyZone])

  return { rtls, health, error, fetchedAt, refresh }
}
