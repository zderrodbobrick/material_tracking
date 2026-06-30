import { useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Header } from './components/Header'
import { SummaryCards } from './components/SummaryCards'
import { LiveQueueTable } from './components/LiveQueueTable'
import { CompletedTable } from './components/CompletedTable'
import { RecentReadsPanel } from './components/RecentReadsPanel'
import { useTheme } from './hooks/useTheme'

const API = 'http://localhost:5001'

async function apiFetch(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export default function App() {
  const { isDark, toggleTheme }             = useTheme()
  const [summary, setSummary]               = useState(null)
  const [liveSessions, setLiveSessions]     = useState([])
  const [completedSessions, setCompleted]   = useState([])
  const [recentReads, setRecentReads]       = useState([])
  const [wsStatus, setWsStatus]             = useState('connecting')
  const [lastUpdated, setLastUpdated]       = useState(null)

  const fetchAll = useCallback(async () => {
    const [sum, live, done, reads] = await Promise.allSettled([
      apiFetch('/api/dashboard/summary'),
      apiFetch('/api/gannomat/live-status'),
      apiFetch('/api/gannomat/completed'),
      apiFetch('/api/reads/recent?limit=20'),
    ])
    if (sum.status  === 'fulfilled') setSummary(sum.value)
    if (live.status === 'fulfilled') setLiveSessions(live.value)
    if (done.status === 'fulfilled') setCompleted(done.value)
    if (reads.status === 'fulfilled') setRecentReads(reads.value)
    setLastUpdated(new Date())
  }, [])

  const handleEndSession = useCallback(async (sessionId) => {
    await fetch(`${API}/api/sessions/${sessionId}/end`, { method: 'POST' })
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    fetchAll()

    const sock = io(API, { transports: ['polling', 'websocket'] })

    sock.on('connect',       () => { setWsStatus('live'); fetchAll() })
    sock.on('disconnect',    () => setWsStatus('reconnecting'))
    sock.on('connect_error', () => setWsStatus('offline'))
    sock.on('rfid_update',   fetchAll)

    const fallback = setInterval(fetchAll, 3000)

    return () => { sock.disconnect(); clearInterval(fallback) }
  }, [fetchAll])

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900
                    dark:bg-slate-950 dark:text-slate-100
                    bg-[radial-gradient(ellipse_at_top,theme(colors.gray.50),theme(colors.gray.100))]
                    dark:bg-[radial-gradient(ellipse_at_top,theme(colors.slate.900),theme(colors.slate.950))]">
      <Header
        wsStatus={wsStatus}
        lastUpdated={lastUpdated}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />
      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
        <SummaryCards summary={summary} />
        <LiveQueueTable sessions={liveSessions} onEndSession={handleEndSession} />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <CompletedTable sessions={completedSessions} />
          <RecentReadsPanel reads={recentReads} />
        </div>
      </main>
    </div>
  )
}
