import { useState, useMemo } from 'react'
import { Search, Filter, Radio } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { DwellTimer } from './DwellTimer'
import { parseEpc } from '../utils/parseEpc'

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
      const hay = `${s.epc ?? ''} ${s.ibus_number ?? ''} ${s.part_name ?? ''}`.toLowerCase()
      if (search && !hay.includes(search.toLowerCase())) return false
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false
      return true
    })
  }, [sessions, search, statusFilter])

  const inputCls =
    'pl-8 pr-3 py-1.5 text-sm rounded-md w-44 transition-colors ' +
    'border border-gray-300 bg-white text-gray-900 placeholder-gray-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
    'dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder-slate-500'

  return (
    <div className="animate-fade-in rounded-xl shadow-sm overflow-hidden
                    bg-white border border-gray-200
                    dark:bg-slate-800/60 dark:border-slate-700/60">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-700/60
                      flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
            </span>
            Live Gannomat Queue
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {sessions.length} active session{sessions.length !== 1 ? 's' : ''} — sorted oldest first
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search part / EPC..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm rounded-md px-2 py-1.5 transition-colors
                         border border-gray-300 bg-white text-gray-900
                         focus:outline-none focus:ring-2 focus:ring-blue-500
                         dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
            >
              <option value="ALL">All</option>
              <option value="open">In Process</option>
              <option value="exit_only">Exit Only</option>
            </select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3
                          bg-gray-100 dark:bg-slate-700/50">
            <Radio className="w-6 h-6 text-gray-400 dark:text-slate-500" />
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {sessions.length === 0 ? 'No active sessions — waiting for RFID reads' : 'No sessions match the current filter'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50 dark:bg-slate-900/40
                             border-b border-gray-200 dark:border-slate-700/60">
                {['Qty', 'Part #', 'Type', 'WO #', 'Full EPC', 'Station', 'Operator', 'Status', 'Entered', 'Current Dwell', ''].map((h, i) => (
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
                  style={{ animationDelay: `${Math.min(i * 35, 400)}ms` }}
                  className={`animate-row-in transition-colors
                    ${s.status === 'exit_only'
                      ? 'bg-orange-50 hover:bg-orange-100 dark:bg-orange-500/5 dark:hover:bg-orange-500/10'
                      : 'hover:bg-gray-50 dark:hover:bg-slate-700/30'}`}
                >
                  {(() => {
                    const p = parseEpc(s.epc)
                    const type = s.part_type ?? p.typeLabel
                    const partNo = s.part_name ?? s.part_number ?? p.partNumber
                    const wo = s.work_order ?? p.workOrder
                    return p.isKnown ? (
                      <>
                        <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap text-slate-800 dark:text-slate-100">
                          {p.qty}
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap text-slate-800 dark:text-slate-100">
                          {partNo}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold
                                           bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">
                            {type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap text-slate-800 dark:text-slate-100">
                          {wo}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-gray-400 dark:text-slate-500">
                          {p.formatted}
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-4 py-3 font-mono font-semibold whitespace-nowrap text-slate-800 dark:text-slate-100">
                        {s.epc ?? s.ibus_number}
                      </td>
                    )
                  })()}
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-slate-400">
                    {s.station_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-slate-300">
                    {s.operator_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs
                                 text-gray-600 dark:text-slate-400">
                    {formatTime(s.entry_time)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DwellTimer
                      entranceTime={s.entry_time}
                      entranceEpochMs={s.entry_epoch_ms}
                      exitTime={null}
                      dwellSeconds={null}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {onEndSession && (
                      <button
                        onClick={() => {
                          const p = parseEpc(s.epc)
                          const label = p.isKnown ? `${s.part_type ?? p.typeLabel} WO#${s.work_order ?? p.workOrder}` : (s.epc ?? s.ibus_number)
                          if (window.confirm(`End session for ${label}?`)) {
                            onEndSession(s.id)
                          }
                        }}
                        className="text-xs font-medium px-2.5 py-1 rounded-md border transition-all
                                   text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300
                                   active:scale-95
                                   dark:text-red-400 dark:border-red-500/30 dark:hover:bg-red-500/10
                                   dark:hover:border-red-500/50"
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
