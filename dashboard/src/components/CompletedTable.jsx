import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col">
      <div className="px-5 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Recently Completed</h2>
          <p className="text-xs text-gray-500 mt-0.5">Last 25 sessions</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search IBUS #..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-40"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-gray-400">
            {sessions.length === 0 ? 'No completed sessions yet' : 'No sessions match filter'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">IBUS #</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Entrance</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Exit</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Dwell</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">In RSSI</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Out RSSI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 whitespace-nowrap">
                    {s.ibus_number}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap font-mono text-xs">
                    {formatTime(s.entrance_time)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap font-mono text-xs">
                    {formatTime(s.exit_time)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-slate-700">
                      {s.dwell_seconds != null ? formatDwell(s.dwell_seconds) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs text-gray-500">
                      {s.entry_rssi != null ? `${s.entry_rssi} dBm` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs text-gray-500">
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
