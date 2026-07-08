import { SummaryCards } from '../components/SummaryCards'
import { CompletedTable } from '../components/CompletedTable'
import { RecentReadsPanel } from '../components/RecentReadsPanel'

export function LiveDashboard({ summary, completedSessions, recentReads }) {
  return (
    <div className="space-y-6">
      <SummaryCards summary={summary} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <CompletedTable sessions={completedSessions} />
        <RecentReadsPanel reads={recentReads} />
      </div>
    </div>
  )
}
