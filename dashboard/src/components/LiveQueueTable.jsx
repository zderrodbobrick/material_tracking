import { useState, useMemo } from 'react'
import { Search, Filter } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { DwellTimer } from './DwellTimer'

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

export function LiveQueueTable({ sessions, onEndSession }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      if (search && !s.ibus_number?.toLowerCase().includes(search.toLowerCase())) return false
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false
      return true
    })
  }, [sessions, search, statusFilter])

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Live Gannomat Queue</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {sessions.length} active session{sessions.length !== 1 ? 's' : ''} — sorted oldest first
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search IBUS #..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-44"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              <option value="IN_PROGRESS">In Process</option>
              <option value="EXIT_ONLY">Exit Only</option>
            </select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <Search className="w-5 h-5 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">
            {sessions.length === 0 ? 'No active sessions — waiting for RFID reads' : 'No sessions match the current filter'}
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
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Last Seen</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">RSSI</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Current Dwell</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => (
                <tr
                  key={s.id}
                  className={`hover:bg-gray-50 transition-colors ${
                    s.status === 'EXIT_ONLY' ? 'bg-orange-50 hover:bg-orange-100' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                    {s.ibus_number}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                    {formatTime(s.entrance_time)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                    {formatTime(s.last_seen)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-mono text-xs text-gray-500">
                      {s.last_rssi != null ? `${s.last_rssi} dBm` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DwellTimer
                      entranceTime={s.entrance_time}
                      entranceEpochMs={s.entrance_epoch_ms}
                      exitTime={null}
                      dwellSeconds={null}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {onEndSession && (
                      <button
                        onClick={() => {
                          if (window.confirm(`End session for ${s.ibus_number}?`)) {
                            onEndSession(s.id)
                          }
                        }}
                        className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors"
                      >
                        End
                      </button>
                    )}
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
