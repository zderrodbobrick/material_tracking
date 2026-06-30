import { useState, useEffect } from 'react'
import { Radio } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

function ConnectionIndicator({ status }) {
  const config = {
    live: {
      dot: 'bg-green-400',
      text: 'text-green-300',
      label: 'Live',
      ring: true,
    },
    reconnecting: {
      dot: 'bg-yellow-400 animate-pulse',
      text: 'text-yellow-300',
      label: 'Reconnecting',
    },
    connecting: {
      dot: 'bg-slate-400 animate-pulse',
      text: 'text-slate-300',
      label: 'Connecting',
    },
    offline: {
      dot: 'bg-red-500',
      text: 'text-red-300',
      label: 'Offline',
    },
  }
  const c = config[status] ?? config.offline

  return (
    <span
      className={`flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full
                  bg-white/10 backdrop-blur-sm ${c.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${c.dot} ${c.ring ? 'animate-pulse-ring' : ''}`} />
      {c.label}
    </span>
  )
}

export function Header({ wsStatus, lastUpdated, isDark, onToggleTheme }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const timeOpts = { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }
  const clockStr = now.toLocaleTimeString('en-US', timeOpts)
  const updatedStr = lastUpdated ? lastUpdated.toLocaleTimeString('en-US', timeOpts) : '—'

  return (
    <header
      className="sticky top-0 z-50 animate-slide-down border-b border-white/10
                 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900
                 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950
                 text-white shadow-lg backdrop-blur-md"
    >
      <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src="/bobrick-logo.png"
            alt="Bobrick — Building Value Since 1906"
            className="h-12 w-auto rounded-lg bg-white p-1.5 shadow-md shrink-0"
          />
          <div className="h-10 w-px bg-white/15 hidden sm:block" />
          <div>
            <div className="flex items-center gap-2.5">
              <span className="relative flex items-center justify-center w-9 h-9 rounded-lg
                               bg-blue-500/20 ring-1 ring-blue-400/30">
                <Radio className="w-5 h-5 text-blue-400" />
                <span className="absolute inset-0 rounded-lg animate-pulse-ring opacity-60" />
              </span>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-300
                             bg-clip-text text-transparent">
                RFID Gannomat Live Dashboard
              </h1>
            </div>
            <p className="text-slate-400 text-sm mt-1 ml-11.5 hidden sm:block">
              Live part tracking, dwell time, and operator association for the Gannomat station.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden md:flex flex-col items-end gap-1">
            <div className="flex items-center gap-3">
              <span className="text-slate-400 text-xs">
                Last Updated: <span className="text-slate-200 font-mono">{updatedStr}</span>
              </span>
              <ConnectionIndicator status={wsStatus} />
            </div>
            <p className="text-slate-300 text-sm font-mono tabular-nums">{clockStr}</p>
          </div>
          <div className="md:hidden">
            <ConnectionIndicator status={wsStatus} />
          </div>
          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  )
}
