import { useState, useEffect, useCallback } from 'react'
import {
  Factory, Search, Filter, Database, ChevronLeft, ChevronRight,
  Activity, CheckCircle, AlertTriangle, Clock,
} from 'lucide-react'
import { apiFetch } from '../api'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { DwellTimer, formatDwell } from '../components/DwellTimer'
import { parseEpc } from '../utils/parseEpc'

function partLabel(row) {
  const p = parseEpc(row.epc ?? row.ibus_number)
  if (p.isKnown) {
    const partNo = row.part_name ?? row.part_number ?? p.partNumber
    const wo = row.work_order ?? p.workOrder
    return `${partNo} · WO#${wo}`
  }
  return row.epc ?? row.ibus_number ?? '—'
}

function formatTime(isoStr) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    })
  } catch { return isoStr }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch { return isoStr }
}

/* ── Station overview card ───────────────────────────────────────────────────── */
function StatMini({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`flex items-center justify-center w-7 h-7 rounded-md ${color}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="leading-none">
        <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-slate-100">{value}</p>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function StationCard({ station }) {
  return (
    <Panel
      title={station.station}
      icon={Factory}
      iconColor="text-violet-500 dark:text-violet-400"
      subtitle={`${station.parts.length} part${station.parts.length !== 1 ? 's' : ''} on the floor now`}
      right={
        <span className="text-xs font-medium px-2.5 py-1 rounded-full
                         bg-violet-50 text-violet-700 border border-violet-200
                         dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30">
          Avg dwell {station.avg_dwell_display ?? '—'}
        </span>
      }
    >
      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-gray-100 dark:border-slate-700/50">
        <StatMini icon={Activity} label="In Process" value={station.in_process}
                  color="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" />
        <StatMini icon={CheckCircle} label="Done Today" value={station.completed_today}
                  color="bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400" />
        <StatMini icon={AlertTriangle} label="Exit Only" value={station.exit_only}
                  color="bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400" />
        <StatMini icon={Clock} label="Total Seen" value={station.total}
                  color="bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300" />
      </div>

      {station.parts.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
          No parts currently at this station
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                {['Part / EPC', 'Status', 'Entered', 'Dwell'].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap text-gray-600 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
              {station.parts.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{partLabel(p)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{formatTime(p.entry_time)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <DwellTimer entranceTime={p.entry_time} entranceEpochMs={p.entry_epoch_ms} exitTime={null} dwellSeconds={null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ── Full database table ─────────────────────────────────────────────────────── */
const PAGE_SIZE = 50

function DatabaseTable({ tick }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ sessions: [], total: 0 })

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => { setPage(0) }, [debounced, status])

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      status,
    })
    if (debounced) params.set('search', debounced)
    try {
      const res = await apiFetch(`/api/report/sessions?${params.toString()}`)
      setData(res)
    } catch { /* keep previous data on transient errors */ }
  }, [page, status, debounced])

  useEffect(() => { load() }, [load, tick])

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const from = data.total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, data.total)

  const inputCls =
    'pl-8 pr-3 py-1.5 text-sm rounded-md w-48 transition-colors ' +
    'border border-gray-300 bg-white text-gray-900 placeholder-gray-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
    'dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder-slate-500'

  return (
    <Panel
      title="Database — All Sessions"
      icon={Database}
      subtitle={`${data.total.toLocaleString()} total record${data.total !== 1 ? 's' : ''}`}
      right={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500 pointer-events-none" />
            <input type="text" placeholder="Search part / EPC..." value={search}
                   onChange={e => setSearch(e.target.value)} className={inputCls} />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
            <select value={status} onChange={e => setStatus(e.target.value)}
                    className="text-sm rounded-md px-2 py-1.5 transition-colors
                               border border-gray-300 bg-white text-gray-900
                               focus:outline-none focus:ring-2 focus:ring-blue-500
                               dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100">
              <option value="ALL">All Statuses</option>
              <option value="open">In Process</option>
              <option value="closed">Completed</option>
              <option value="exit_only">Exit Only</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </div>
        </div>
      }
    >
      {data.sessions.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-gray-400 dark:text-slate-500">
          No records match the current filter
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                {['ID', 'Part / EPC', 'Type', 'WO #', 'Station', 'Status', 'Entered', 'Exit', 'Dwell'].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap text-gray-600 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
              {data.sessions.map(s => {
                const p = parseEpc(s.epc ?? s.ibus_number)
                return (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400 dark:text-slate-500">{s.id}</td>
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{s.part_name ?? s.part_number ?? p.partNumber ?? s.epc ?? s.ibus_number}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{s.part_type ?? p.typeLabel ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{s.work_order ?? p.workOrder ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{s.station_name ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><StatusBadge status={s.status} /></td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{formatDateTime(s.entry_time)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{formatDateTime(s.exit_time)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    {s.dwell_seconds != null ? formatDwell(s.dwell_seconds) : '—'}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-5 py-3 flex items-center justify-between border-t border-gray-200 dark:border-slate-700/60">
        <p className="text-xs text-gray-500 dark:text-slate-400">
          Showing <span className="font-semibold">{from}–{to}</span> of {data.total.toLocaleString()}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-all
                             border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed
                             dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/40">
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums">Page {page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-all
                             border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed
                             dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/40">
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Panel>
  )
}

export function FullReport({ tick }) {
  const [stations, setStations] = useState([])

  useEffect(() => {
    let alive = true
    apiFetch('/api/report/stations')
      .then(res => { if (alive) setStations(res.stations || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [tick])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        {stations.map(s => <StationCard key={s.station} station={s} />)}
      </div>
      <DatabaseTable tick={tick} />
    </div>
  )
}
