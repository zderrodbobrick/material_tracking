import { useState, useEffect } from 'react'

export function formatDwell(totalSec) {
  if (totalSec == null || totalSec < 0) return '0s'
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rm = m % 60
    return `${h}h ${rm}m ${s}s`
  }
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function DwellTimer({ entranceTime, entranceEpochMs, exitTime, dwellSeconds }) {
  const [elapsed, setElapsed] = useState(0)

  const rawStartMs = entranceEpochMs ?? (entranceTime ? new Date(entranceTime).getTime() : null)

  useEffect(() => {
    if (!rawStartMs || exitTime != null) return
    // Clamp once at effect-run time so a reader clock ahead of the browser
    // never stalls the timer at 0 across renders
    const start = Math.min(rawStartMs, Date.now())
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [rawStartMs, exitTime])

  if (!rawStartMs && !entranceTime) return <span className="text-gray-400">—</span>

  if (exitTime != null && dwellSeconds != null) {
    return <span className="font-mono text-gray-700">{formatDwell(dwellSeconds)}</span>
  }

  return (
    <span className="font-mono text-blue-600 font-semibold tabular-nums">
      {formatDwell(elapsed)}
    </span>
  )
}
