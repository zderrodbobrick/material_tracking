import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { Search, ChevronLeft, ChevronRight, ChevronDown, Download } from 'lucide-react'
import { apiFetch } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { DwellTimer, formatDwell } from '../components/DwellTimer'
import { parseEpc } from '../utils/parseEpc'

const PAGE_SIZE = 50

function formatDateTime(isoStr) {
 if (!isoStr) return '—'
 try {
  return new Date(isoStr).toLocaleString('en-US', {
   month: 'short',
   day: 'numeric',
   hour: 'numeric',
   minute: '2-digit',
   second: '2-digit',
   hour12: true,
  })
 } catch {
  return isoStr
 }
}

function formatDateShort(d = new Date()) {
 return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function operatorLabel(s) {
 if (s.operator_name) return s.operator_name
 const worked = s.operators_worked ?? []
 if (worked.length) return worked.map(o => o.operator_name).filter(Boolean).join(', ')
 const present = s.operators_present ?? []
 if (present.length) return present.map(o => o.operator_name).filter(Boolean).join(', ')
 return '—'
}

function csvEscape(v) {
 const s = v == null ? '' : String(v)
 if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
 return s
}

function downloadCsv(filename, rows) {
 const headers = [
  'Session ID', 'Part / EPC', 'Drawing', 'Work Order', 'Station', 'Operator',
  'Entered', 'Exited', 'Dwell (sec)', 'Dwell', 'Status',
 ]
 const lines = [headers.join(',')]
 for (const s of rows) {
  const p = parseEpc(s.epc ?? s.ibus_number)
  lines.push([
   s.id,
   s.part_name ?? s.part_number ?? p.partNumber ?? s.epc ?? s.ibus_number ?? '',
   s.drawing ?? '',
   s.work_order ?? p.workOrder ?? s.ibus_number ?? '',
   s.station_name ?? '',
   operatorLabel(s),
   s.entry_time ?? '',
   s.exit_time ?? '',
   s.dwell_seconds ?? '',
   s.dwell_seconds != null ? formatDwell(s.dwell_seconds) : '',
   s.status ?? '',
  ].map(csvEscape).join(','))
 }
 const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url
 a.download = filename
 a.click()
 URL.revokeObjectURL(url)
}

/* ── Compact station summary ─────────────────────────────────────────────────── */
function StationSummary({ stations }) {
 const [expanded, setExpanded] = useState(null)

 if (!stations.length) return null

 return (
  <section className="bb-section">
   <h2 className="bb-section-title">Station summary</h2>
   <div className="bb-table-wrap">
    <table className="bb-table">
     <thead className="bb-table-head">
      <tr>
       <th>Station</th>
       <th className="text-right">On Floor</th>
       <th className="text-right">Completed Today</th>
       <th className="text-right">Missing Entry Read</th>
       <th className="text-right">Total Processed</th>
       <th className="text-right">Avg Dwell</th>
      </tr>
     </thead>
     <tbody>
      {stations.map(st => {
       const open = expanded === st.station
       const onFloor = st.parts?.length ?? st.in_process ?? 0
       return (
        <Fragment key={st.station}>
         <tr
          className={`bb-table-row cursor-pointer ${open ? 'bb-table-row-active' : ''}`}
          onClick={() => setExpanded(open ? null : st.station)}
         >
          <td>
           <span className="inline-flex items-center gap-1.5 font-medium text-[#eef2f7]">
            <ChevronDown
             className={`w-3.5 h-3.5 text-[#8b939e] transition-transform ${open ? '' : '-rotate-90'}`}
            />
            {st.station}
           </span>
          </td>
          <td className="text-right tabular-nums">{onFloor}</td>
          <td className="text-right tabular-nums">{st.completed_today ?? 0}</td>
          <td className="text-right tabular-nums">{st.exit_only ?? 0}</td>
          <td className="text-right tabular-nums">{st.total ?? 0}</td>
          <td className="text-right font-mono text-xs tabular-nums">
           {st.avg_dwell_display ?? '—'}
          </td>
         </tr>
         {open && (
          <tr className="bb-table-row">
           <td colSpan={6} className="p-0 bg-[#08080a]/60">
            {(st.parts ?? []).length === 0 ? (
             <p className="px-4 py-3 text-xs text-[#8b939e]">
              No parts currently at this station
             </p>
            ) : (
             <table className="w-full text-sm">
              <thead>
               <tr className="text-left text-[11px] uppercase tracking-wider text-[#8b939e] border-b border-[#2a2a32]">
                <th className="px-4 py-2 font-semibold">Part / EPC</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Entered</th>
                <th className="px-4 py-2 font-semibold text-right">Dwell</th>
               </tr>
              </thead>
              <tbody>
               {st.parts.map(p => (
                <tr key={p.id} className="border-b border-[#2a2a32]/60 last:border-0">
                 <td className="px-4 py-2 font-mono text-xs text-[#eef2f7]">
                  {p.part_name ?? p.part_number ?? p.epc ?? p.ibus_number ?? '—'}
                 </td>
                 <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                 <td className="px-4 py-2 font-mono text-xs text-[#8b939e]">
                  {formatDateTime(p.entry_time)}
                 </td>
                 <td className="px-4 py-2 text-right font-mono text-xs">
                  <DwellTimer
                   entranceTime={p.entry_time}
                   entranceEpochMs={p.entry_epoch_ms}
                   exitTime={null}
                   dwellSeconds={null}
                  />
                 </td>
                </tr>
               ))}
              </tbody>
             </table>
            )}
           </td>
          </tr>
         )}
        </Fragment>
       )
      })}
     </tbody>
    </table>
   </div>
  </section>
 )
}

/* ── Session history table ───────────────────────────────────────────────────── */
function SessionHistory({ tick, stationOptions }) {
 const [search, setSearch] = useState('')
 const [debounced, setDebounced] = useState('')
 const [status, setStatus] = useState('ALL')
 const [dateFrom, setDateFrom] = useState('')
 const [dateTo, setDateTo] = useState('')
 const [station, setStation] = useState('')
 const [workOrder, setWorkOrder] = useState('')
 const [operatorId, setOperatorId] = useState('')
 const [operators, setOperators] = useState([])
 const [page, setPage] = useState(0)
 const [data, setData] = useState({ sessions: [], total: 0 })
 const [exporting, setExporting] = useState(false)

 useEffect(() => {
  const id = setTimeout(() => setDebounced(search), 300)
  return () => clearTimeout(id)
 }, [search])

 useEffect(() => { setPage(0) }, [debounced, status, dateFrom, dateTo, station, workOrder, operatorId])

 useEffect(() => {
  apiFetch('/api/operators')
   .then(rows => setOperators(Array.isArray(rows) ? rows.filter(o => o.is_active !== false) : []))
   .catch(() => {})
 }, [])

 const queryParams = useCallback((overrides = {}) => {
  const params = new URLSearchParams({
   limit: String(overrides.limit ?? PAGE_SIZE),
   offset: String(overrides.offset ?? page * PAGE_SIZE),
   status,
  })
  if (debounced) params.set('search', debounced)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  if (station) params.set('station', station)
  if (workOrder.trim()) params.set('work_order', workOrder.trim())
  if (operatorId) params.set('operator_id', operatorId)
  if (overrides.export) params.set('export', '1')
  return params
 }, [page, status, debounced, dateFrom, dateTo, station, workOrder, operatorId])

 const load = useCallback(async () => {
  try {
   const res = await apiFetch(`/api/report/sessions?${queryParams().toString()}`)
   setData(res)
  } catch { /* keep previous */ }
 }, [queryParams])

 useEffect(() => { load() }, [load, tick])

 const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
 const from = data.total === 0 ? 0 : page * PAGE_SIZE + 1
 const to = Math.min((page + 1) * PAGE_SIZE, data.total)

 const handleExport = async () => {
  setExporting(true)
  try {
   const params = queryParams({ limit: 5000, offset: 0, export: true })
   const res = await apiFetch(`/api/report/sessions?${params.toString()}`)
   const rows = res.sessions ?? []
   const stamp = new Date().toISOString().slice(0, 10)
   downloadCsv(`rfid-session-history-${stamp}.csv`, rows)
  } catch {
   /* ignore */
  } finally {
   setExporting(false)
  }
 }

 return (
  <section className="bb-section">
   <div>
    <h2 className="bb-page-title text-base">RFID Session History</h2>
    <p className="bb-page-sub">
     {data.total.toLocaleString()} record{data.total !== 1 ? 's' : ''}
    </p>
   </div>

   <div className="flex flex-wrap items-center gap-2">
    <input
     type="date"
     value={dateFrom}
     onChange={e => setDateFrom(e.target.value)}
     className="bb-input"
     title="From date"
    />
    <input
     type="date"
     value={dateTo}
     onChange={e => setDateTo(e.target.value)}
     className="bb-input"
     title="To date"
    />
    <input
     type="text"
     value={workOrder}
     onChange={e => setWorkOrder(e.target.value)}
     placeholder="Work order"
     className="bb-input w-32"
    />
    <select
     value={station}
     onChange={e => setStation(e.target.value)}
     className="bb-select"
    >
     <option value="">All stations</option>
     {stationOptions.map(name => (
      <option key={name} value={name}>{name}</option>
     ))}
    </select>
    <select
     value={operatorId}
     onChange={e => setOperatorId(e.target.value)}
     className="bb-select"
    >
     <option value="">All operators</option>
     {operators.map(o => (
      <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>
     ))}
    </select>
    <select
     value={status}
     onChange={e => setStatus(e.target.value)}
     className="bb-select"
    >
     <option value="ALL">All statuses</option>
     <option value="open">In Process</option>
     <option value="closed">Completed</option>
     <option value="exit_only">Missing Entry Read</option>
     <option value="abandoned">Abandoned</option>
    </select>
    <div className="relative">
     <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#8b939e] pointer-events-none" />
     <input
      type="text"
      placeholder="Search part / EPC…"
      value={search}
      onChange={e => setSearch(e.target.value)}
      className="bb-input pl-8 w-48"
     />
    </div>
    <button
     type="button"
     onClick={handleExport}
     disabled={exporting || data.total === 0}
     className="bb-btn-outline ml-auto disabled:opacity-40"
    >
     <Download className="w-3.5 h-3.5" />
     {exporting ? 'Exporting…' : 'Export CSV'}
    </button>
   </div>

   <div className="bb-table-wrap max-h-[min(70vh,720px)] overflow-auto">
    {data.sessions.length === 0 ? (
     <p className="bb-empty">No records match the current filters</p>
    ) : (
     <table className="bb-table">
      <thead className="bb-table-head sticky top-0 z-10">
       <tr>
        <th className="text-right">ID</th>
        <th>Part / EPC</th>
        <th>Drawing</th>
        <th>Work Order</th>
        <th>Station</th>
        <th>Operator</th>
        <th>Entered</th>
        <th>Exited</th>
        <th className="text-right">Dwell</th>
        <th>Status</th>
       </tr>
      </thead>
      <tbody>
       {data.sessions.map(s => {
        const p = parseEpc(s.epc ?? s.ibus_number)
        return (
         <tr key={s.id} className="bb-table-row">
          <td className="text-right font-mono text-xs text-[#8b939e] tabular-nums">{s.id}</td>
          <td className="font-mono text-xs font-semibold text-[#eef2f7] whitespace-nowrap">
           {s.part_name ?? s.part_number ?? p.partNumber ?? s.epc ?? s.ibus_number}
          </td>
          <td className="text-xs text-[#eef2f7] max-w-[12rem] truncate" title={s.drawing || ''}>
           {s.drawing || '—'}
          </td>
          <td className="font-mono text-xs text-[#8b939e] whitespace-nowrap">
           {s.work_order ?? p.workOrder ?? '—'}
          </td>
          <td className="text-xs text-[#eef2f7] whitespace-nowrap">{s.station_name ?? '—'}</td>
          <td className="text-xs text-[#8b939e] whitespace-nowrap">{operatorLabel(s)}</td>
          <td
           className="font-mono text-xs text-[#8b939e] whitespace-nowrap"
           title={s.entry_time || undefined}
          >
           {formatDateTime(s.entry_time)}
          </td>
          <td
           className="font-mono text-xs text-[#8b939e] whitespace-nowrap"
           title={s.exit_time || undefined}
          >
           {formatDateTime(s.exit_time)}
          </td>
          <td className="text-right font-mono text-xs font-semibold tabular-nums whitespace-nowrap">
           {s.dwell_seconds != null ? formatDwell(s.dwell_seconds) : '—'}
          </td>
          <td><StatusBadge status={s.status} /></td>
         </tr>
        )
       })}
      </tbody>
     </table>
    )}
   </div>

   <div className="flex items-center justify-between">
    <p className="text-xs text-[#8b939e]">
     Showing <span className="font-semibold text-[#eef2f7]">{from}–{to}</span> of{' '}
     {data.total.toLocaleString()}
    </p>
    <div className="flex items-center gap-2">
     <button
      type="button"
      onClick={() => setPage(p => Math.max(0, p - 1))}
      disabled={page === 0}
      className="bb-btn-outline disabled:opacity-40"
     >
      <ChevronLeft className="w-3.5 h-3.5" /> Prev
     </button>
     <span className="text-xs text-[#8b939e] tabular-nums">
      Page {page + 1} / {totalPages}
     </span>
     <button
      type="button"
      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
      disabled={page >= totalPages - 1}
      className="bb-btn-outline disabled:opacity-40"
     >
      Next <ChevronRight className="w-3.5 h-3.5" />
     </button>
    </div>
   </div>
  </section>
 )
}

export function FullReport({ tick }) {
 const [stations, setStations] = useState([])
 const [totalSessions, setTotalSessions] = useState(null)

 useEffect(() => {
  let alive = true
  apiFetch('/api/report/stations')
   .then(res => { if (alive) setStations(res.stations || []) })
   .catch(() => {})
  apiFetch('/api/report/sessions?limit=1&status=ALL')
   .then(res => { if (alive) setTotalSessions(res.total ?? null) })
   .catch(() => {})
  return () => { alive = false }
 }, [tick])

 const stationOptions = useMemo(
  () => stations.map(s => s.station).filter(Boolean).sort(),
  [stations],
 )

 const sessionCount = totalSessions ?? stations.reduce((n, s) => n + (s.total ?? 0), 0)

 return (
  <div className="space-y-5">
   <div>
    <h1 className="bb-page-title">Full Report</h1>
    <p className="bb-page-sub">
     {sessionCount.toLocaleString()} sessions · {formatDateShort()}
    </p>
   </div>

   <StationSummary stations={stations} />
   <SessionHistory tick={tick} stationOptions={stationOptions} />
  </div>
 )
}
