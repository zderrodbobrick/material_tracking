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
    <p className="text-lg font-bold tabular-nums text-[#eef2f7]">{value}</p>
    <p className="text-[10px] uppercase tracking-wide text-[#8b939e] mt-0.5">{label}</p>
   </div>
  </div>
 )
}

function StationCard({ station }) {
 return (
  <Panel
   title={station.station}
   icon={Factory}
   iconColor="text-[#4dc4f4]"
   subtitle={`${station.parts.length} part${station.parts.length !== 1 ? 's' : ''} on the floor now`}
   right={
    <span className="text-xs font-medium px-2.5 py-1 rounded-full
 bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/30
             dark:bg-[#a78bfa]/100/10 border-[#a78bfa]/30">
     Avg dwell {station.avg_dwell_display ?? '—'}
    </span>
   }
  >
   <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-[#27272f]/80">
    <StatMini icon={Activity} label="In Process" value={station.in_process}
         color="bg-[#4dc4f4]/10 text-[#4dc4f4]" />
    <StatMini icon={CheckCircle} label="Done Today" value={station.completed_today}
         color="bg-[#34d399]/10 text-[#34d399]" />
    <StatMini icon={AlertTriangle} label="Exit Only" value={station.exit_only}
         color="bg-[#fbbf24]/10 text-[#fbbf24]" />
    <StatMini icon={Clock} label="Total Seen" value={station.total}
         color="bg-[#18181d]/5 text-[#8b939e]" />
   </div>

   {station.parts.length === 0 ? (
    <div className="px-5 py-8 text-center text-sm text-[#8b939e]">
     No parts currently at this station
    </div>
   ) : (
    <div className="overflow-x-auto">
     <table className="w-full text-sm">
      <thead>
       <tr className="text-left bg-[#08080a] border-b border-[#27272f]">
        {['Part / EPC', 'Status', 'Entered', 'Dwell'].map((h, i) => (
         <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap text-[#8b939e]">{h}</th>
        ))}
       </tr>
      </thead>
      <tbody className="divide-y divide-[#27272f]/50">
       {station.parts.map(p => (
        <tr key={p.id} className="hover:bg-[#4dc4f4]/5 transition-colors">
         <td className="px-4 py-2.5 font-mono font-semibold text-[#eef2f7] whitespace-nowrap">{partLabel(p)}</td>
         <td className="px-4 py-2.5 whitespace-nowrap"><StatusBadge status={p.status} /></td>
         <td className="px-4 py-2.5 font-mono text-xs text-[#8b939e] whitespace-nowrap">{formatTime(p.entry_time)}</td>
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
  'border border-[#27272f] bg-[#18181d] text-[#eef2f7] placeholder-[#8b939e] ' +
  'focus:outline-none focus:ring-2 focus:ring-[#4dc4f4] focus:border-transparent ' +
  ' bg-[#08080a] text-[#eef2f7] '

 return (
  <Panel
   title="Database — All Sessions"
   icon={Database}
   subtitle={`${data.total.toLocaleString()} total record${data.total !== 1 ? 's' : ''}`}
   right={
    <div className="flex items-center gap-2">
     <div className="relative">
      <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#8b939e] pointer-events-none" />
      <input type="text" placeholder="Search part / EPC..." value={search}
          onChange={e => setSearch(e.target.value)} className={inputCls} />
     </div>
     <div className="flex items-center gap-1.5">
      <Filter className="w-3.5 h-3.5 text-[#8b939e]" />
      <select value={status} onChange={e => setStatus(e.target.value)}
          className="text-sm rounded-md px-2 py-1.5 transition-colors
 border border-[#27272f] bg-[#18181d] text-[#eef2f7]
                focus:outline-none focus:ring-2 focus:ring-[#4dc4f4]
                bg-[#08080a] text-[#eef2f7]">
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
    <div className="px-5 py-14 text-center text-sm text-[#8b939e]">
     No records match the current filter
    </div>
   ) : (
    <div className="overflow-x-auto">
     <table className="w-full text-sm">
      <thead>
       <tr className="text-left bg-[#08080a] border-b border-[#27272f]">
        {['ID', 'Part / EPC', 'Type', 'WO #', 'Station', 'Status', 'Entered', 'Exit', 'Dwell'].map((h, i) => (
         <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap text-[#8b939e]">{h}</th>
        ))}
       </tr>
      </thead>
      <tbody className="divide-y divide-[#27272f]/50">
       {data.sessions.map(s => {
        const p = parseEpc(s.epc ?? s.ibus_number)
        return (
        <tr key={s.id} className="hover:bg-[#4dc4f4]/5 transition-colors">
         <td className="px-4 py-2.5 font-mono text-xs text-[#8b939e]">{s.id}</td>
         <td className="px-4 py-2.5 font-mono font-semibold text-[#eef2f7] whitespace-nowrap">{s.part_name ?? s.part_number ?? p.partNumber ?? s.epc ?? s.ibus_number}</td>
         <td className="px-4 py-2.5 text-xs text-[#8b939e] whitespace-nowrap">{s.part_type ?? p.typeLabel ?? '—'}</td>
         <td className="px-4 py-2.5 font-mono text-xs text-[#8b939e] whitespace-nowrap">{s.work_order ?? p.workOrder ?? '—'}</td>
         <td className="px-4 py-2.5 text-xs text-[#8b939e] whitespace-nowrap">{s.station_name ?? '—'}</td>
         <td className="px-4 py-2.5 whitespace-nowrap"><StatusBadge status={s.status} /></td>
         <td className="px-4 py-2.5 font-mono text-xs text-[#8b939e] whitespace-nowrap">{formatDateTime(s.entry_time)}</td>
         <td className="px-4 py-2.5 font-mono text-xs text-[#8b939e] whitespace-nowrap">{formatDateTime(s.exit_time)}</td>
         <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#eef2f7] dark:text-[#eef2f7] whitespace-nowrap">
          {s.dwell_seconds != null ? formatDwell(s.dwell_seconds) : '—'}
         </td>
        </tr>
        )
       })}
      </tbody>
     </table>
    </div>
   )}

   <div className="px-5 py-3 flex items-center justify-between border-t border-[#27272f]">
    <p className="text-xs text-[#8b939e]">
     Showing <span className="font-semibold">{from}–{to}</span> of {data.total.toLocaleString()}
    </p>
    <div className="flex items-center gap-2">
     <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
         className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-all
 border-[#27272f] text-[#8b939e] hover:bg-[#4dc4f4]/5 disabled:opacity-40 disabled:cursor-not-allowed
               dark:text-[#8b939e] hover:bg-[#4dc4f4]/10">
      <ChevronLeft className="w-3.5 h-3.5" /> Prev
     </button>
     <span className="text-xs text-[#8b939e] tabular-nums">Page {page + 1} / {totalPages}</span>
     <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
         className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-all
 border-[#27272f] text-[#8b939e] hover:bg-[#4dc4f4]/5 disabled:opacity-40 disabled:cursor-not-allowed
               dark:text-[#8b939e] hover:bg-[#4dc4f4]/10">
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
