import { useState, useMemo } from 'react'
import { Search, CheckCircle } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { formatDwell } from './DwellTimer'

function formatTime(isoStr) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  } catch {
    return isoStr
  }
}

export function CompletedTable({ sessions }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return sessions
    return sessions.filter(s =>
      s.ibus_number?.toLowerCase().includes(search.toLowerCase())
    )
  }, [sessions, search])

  return (
    <div className="animate-fade-in rounded-xl shadow-sm flex flex-col overflow-hidden
                    bg-white border border-gray-200
                    dark:bg-slate-800/60 dark:border-slate-700/60">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-700/60
                      flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100">
            <CheckCircle className="w-4 h-4 text-green-500 dark:text-green-400" />
            Recently Completed
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Last 25 sessions</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search IBUS #..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm rounded-md w-40 transition-colors
                       border border-gray-300 bg-white text-gray-900 placeholder-gray-400
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder-slate-500"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-gray-400 dark:text-slate-500">
            {sessions.length === 0 ? 'No completed sessions yet' : 'No sessions match filter'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50 dark:bg-slate-900/40
                             border-b border-gray-200 dark:border-slate-700/60">
                {['IBUS #', 'Status', 'Entrance', 'Exit', 'Dwell', 'In RSSI', 'Out RSSI'].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap
                                         text-gray-600 dark:text-slate-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
              {filtered.map((s, i) => (
                <tr
                  key={s.id}
                  style={{ animationDelay: `${Math.min(i * 30, 350)}ms` }}
                  className="animate-row-in transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30"
                >
                  <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap
                                 text-slate-800 dark:text-slate-100">
                    {s.ibus_number}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs
                                 text-gray-600 dark:text-slate-400">
                    {formatTime(s.entrance_time)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs
                                 text-gray-600 dark:text-slate-400">
                    {formatTime(s.exit_time)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {s.dwell_seconds != null ? formatDwell(s.dwell_seconds) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs text-gray-500 dark:text-slate-400">
                      {s.entry_rssi != null ? `${s.entry_rssi} dBm` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs text-gray-500 dark:text-slate-400">
                      {s.exit_rssi != null ? `${s.exit_rssi} dBm` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
