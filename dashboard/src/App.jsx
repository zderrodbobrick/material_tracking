import { useState, useEffect, useCallback } from 'react'
import { Header } from './components/Header'
import { LandingPage } from './pages/LandingPage'
import { LiveDashboard } from './pages/LiveDashboard'
import { CompletedIbusPage } from './pages/CompletedIbusPage'
import { FullReport } from './pages/FullReport'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { OperatorAnalyticsPage } from './pages/OperatorAnalyticsPage'
import { StationSettingsPage } from './pages/StationSettingsPage'
import { useTheme } from './hooks/useTheme'
import { useLiveSocket } from './hooks/useLiveSocket'
import { apiFetch } from './api'

const ENTERED_KEY = 'rfid-entered'

export default function App() {
 useTheme()
 const { wsStatus, tick } = useLiveSocket()

 const [entered, setEntered] = useState(() => sessionStorage.getItem(ENTERED_KEY) === '1')
 const [tab, setTab] = useState('live')

 // Live dashboard data (also powers the landing teaser)
 const [summary, setSummary]      = useState(null)
 const [liveSessions, setLiveSessions] = useState([])
 const [lastUpdated, setLastUpdated]  = useState(null)

 const fetchLive = useCallback(async () => {
  const live = await apiFetch('/api/live').catch(() => null)
  if (live) setLiveSessions(live)
  setLastUpdated(new Date())
 }, [])

 useEffect(() => {
  apiFetch('/api/summary')
   .then(setSummary)
   .catch(() => {})
 }, [])

 useEffect(() => {
  if (tab === 'live') fetchLive()
 }, [fetchLive, tick, tab])

 const enter = useCallback(() => {
  sessionStorage.setItem(ENTERED_KEY, '1')
  setEntered(true)
 }, [])

 const goHome = useCallback(() => {
  sessionStorage.removeItem(ENTERED_KEY)
  setEntered(false)
 }, [])

 if (!entered) {
  return (
   <LandingPage
    summary={summary}
    wsStatus={wsStatus}
    onEnter={enter}
   />
  )
 }

 return (
  <div className="min-h-screen bg-[#0c0c0e] text-[#eef2f7]">
   <Header
    wsStatus={wsStatus}
    lastUpdated={lastUpdated}
    activeTab={tab}
    onTabChange={setTab}
    onHome={goHome}
   />
   <main className="w-full px-3 sm:px-4 py-3">
    {tab === 'live' && (
     <LiveDashboard liveSessions={liveSessions} tick={tick} />
    )}
    {tab === 'completed' && <CompletedIbusPage tick={tick} />}
    {tab === 'report' && <FullReport tick={tick} />}
    {tab === 'analytics' && <AnalyticsPage />}
    {tab === 'operators' && <OperatorAnalyticsPage tick={tick} />}
    {tab === 'settings' && <StationSettingsPage />}
   </main>
  </div>
 )
}
