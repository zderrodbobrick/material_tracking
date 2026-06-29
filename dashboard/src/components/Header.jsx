import { useState, useEffect } from 'react'
import { Radio } from 'lucide-react'

function ConnectionIndicator({ status }) {
  if (status === 'live') {
    return (
      <span className="flex items-center gap-1.5 text-green-400 text-sm font-medium">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        Live
      </span>
    )
  }
  if (status === 'reconnecting') {
    return (
      <span className="flex items-center gap-1.5 text-yellow-400 text-sm font-medium">
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        Reconnecting
      </span>
    )
  }
  if (status === 'connecting') {
    return (
      <span className="flex items-center gap-1.5 text-slate-400 text-sm font-medium">
        <span className="w-2 h-2 rounded-full bg-slate-400" />
        Connecting
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-red-400 text-sm font-medium">
      <span className="w-2 h-2 rounded-full bg-red-500" />
      Offline
    </span>
  )
}

export function Header({ wsStatus, lastUpdated }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const clockStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    : '—'

  return (
    <header className="bg-slate-800 text-white shadow-md">
      <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-400" />
            <h1 className="text-xl font-bold tracking-tight">
              RFID Gannomat Live Dashboard
            </h1>
          </div>
          <p className="text-slate-400 text-sm mt-0.5 ml-7">
            Live part tracking, dwell time, and operator association for the Gannomat station.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs">
              Last Updated: <span className="text-slate-200 font-mono">{updatedStr}</span>
            </span>
            <ConnectionIndicator status={wsStatus} />
          </div>
          <p className="text-slate-300 text-sm font-mono">{clockStr}</p>
        </div>
      </div>
    </header>
  )
}
