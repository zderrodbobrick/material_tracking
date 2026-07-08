import { useMemo } from 'react'
import { SummaryCards } from '../components/SummaryCards'
import { LiveQueueTable } from '../components/LiveQueueTable'
import { CompletedTable } from '../components/CompletedTable'
import { RecentReadsPanel } from '../components/RecentReadsPanel'

const STATION_ORDER = ['Gannomat', 'Insert Station']

export function LiveDashboard({ summary, liveSessions, completedSessions, recentReads, onEndSession }) {
  const sessionsByStation = useMemo(() => {
    const grouped = {}
    for (const session of liveSessions) {
      const name = session.station_name ?? 'Unknown'
      if (!grouped[name]) grouped[name] = []
      grouped[name].push(session)
    }
    return grouped
  }, [liveSessions])

  const stationNames = useMemo(() => {
    const names = new Set(STATION_ORDER)
    for (const name of Object.keys(sessionsByStation)) names.add(name)
    return [...names]
  }, [sessionsByStation])

  return (
    <div className="space-y-6">
      <SummaryCards summary={summary} />
      {stationNames.map(stationName => (
        <LiveQueueTable
          key={stationName}
          stationName={stationName}
          sessions={sessionsByStation[stationName] ?? []}
          onEndSession={onEndSession}
        />
      ))}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <CompletedTable sessions={completedSessions} />
        <RecentReadsPanel reads={recentReads} />
      </div>
    </div>
  )
}
