import { useState, useEffect } from 'react'

export function formatDwell(totalSec) {
  if (totalSec == null || totalSec < 0) return '0s'
  const sec = Math.floor(totalSec)
  const m = Math.floor(sec / 60)
  const s = sec % 60
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

  if (!rawStartMs && !entranceTime) return <span className="text-gray-400 dark:text-slate-500">—</span>

  if (exitTime != null && dwellSeconds != null) {
    return <span className="font-mono text-gray-700 dark:text-slate-300">{formatDwell(dwellSeconds)}</span>
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums
                     text-blue-600 dark:text-blue-400">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
      {formatDwell(elapsed)}
    </span>
  )
}
