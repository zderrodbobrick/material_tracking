import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { apiFetch } from '../api'
import { VerticalBars, HorizontalBars } from '../components/charts'

const TABS = [
 { id: 'live', label: 'Live' },
 { id: 'trends', label: 'Trends' },
]

const RANGE_PRESETS = [
 { id: 'all', label: 'All time' },
 { id: '7', label: '1 week' },
 { id: '14', label: '2 weeks' },
 { id: '30', label: '30 days' },
 { id: '90', label: '90 days' },
]

function formatWhen(iso) {
 if (!iso) return '—'
 try {
  return new Date(iso).toLocaleString('en-US', {
   month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
 } catch {
  return iso
 }
}

function formatMetricValue(metric, value) {
 if (value == null || Number.isNaN(value)) return '—'
 if (metric === 'active_time' || metric === 'median_operator_dwell' || metric === 'median_part_dwell') {
  const sec = Math.round(value)
  if (sec < 60) return `${sec} sec`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
 }
 if (metric === 'pct_within_target' || metric === 'exception_rate') return `${Number(value).toFixed(1)}%`
 if (metric === 'parts') return String(Math.round(value))
 return Number(value).toFixed(1)
}

async function loadLiveData() {
 try {
  return await apiFetch('/api/analytics/operators')
 } catch {
  const [analytics, operators] = await Promise.all([
   apiFetch('/api/analytics'),
   apiFetch('/api/operators'),
  ])
  const op = analytics.operators ?? {}
  const lbMap = new Map((op.leaderboard ?? []).map(o => [o.operator_id, o]))
  return {
   summary: { ...(op.summary ?? {}), scope: 'today' },
   leaderboard: op.leaderboard ?? [],
   currently_in_zone: [],
   roster: (operators ?? []).map(o => {
    const stats = lbMap.get(o.operator_id)
    return {
     operator_id: o.operator_id,
     operator_name: o.operator_name,
     employee_number: o.employee_number,
     rtls_badge_id: o.rtls_badge_id,
     is_active: !!o.is_active,
     parts_today: stats?.completed_pieces ?? 0,
     stations_today: stats?.stations_worked ?? 0,
     in_progress: stats?.in_progress ?? 0,
    }
   }),
   recent_assignments: [],
  }
 }
}

/* ── Live drawer (who / where right now) ────────────────────────────────────── */

function LiveDrawer({ operatorId, rosterRow, inZoneProp, onClose, tick = 0 }) {
 const [detail, setDetail] = useState(null)

 useEffect(() => {
  let alive = true
  apiFetch(`/api/analytics/operators/${operatorId}`)
   .then(d => { if (alive) setDetail(d) })
   .catch(() => { if (alive) setDetail(null) })
  return () => { alive = false }
 }, [operatorId, tick])

 const name = detail?.operator?.operator_name || rosterRow?.operator_name || 'Operator'
 const badge = detail?.operator?.rtls_badge_id ?? rosterRow?.rtls_badge_id
 const zone = detail?.currently_in_zone || inZoneProp
 const recent = detail?.recent_assignments ?? []

 return (
  <div className="bb-drawer-backdrop" onClick={onClose}>
   <aside className="bb-drawer" onClick={e => e.stopPropagation()}>
    <div className="bb-panel-header border-b border-[#2a2a32]">
     <div className="min-w-0">
      <h2 className="bb-title truncate">{name}</h2>
      <p className="bb-subtitle">
       {badge != null ? `Badge ${badge}` : 'No badge'}
       {zone?.station_name ? ` · ${zone.station_name}` : ' · Idle'}
      </p>
     </div>
     <button type="button" onClick={onClose} className="bb-btn-ghost p-1.5" aria-label="Close">
      <X className="w-4 h-4" />
     </button>
    </div>

    <div className="p-4 space-y-4 overflow-y-auto flex-1">
     <div className="bb-kpi-strip">
      <div>
       <p className="bb-kpi-label">Parts today</p>
       <p className="bb-kpi-value">{rosterRow?.parts_today ?? rosterRow?.completed_pieces ?? 0}</p>
      </div>
      <div>
       <p className="bb-kpi-label">In progress</p>
       <p className="bb-kpi-value">{rosterRow?.in_progress ?? 0}</p>
      </div>
      <div>
       <p className="bb-kpi-label">Stations today</p>
       <p className="bb-kpi-value">{rosterRow?.stations_today ?? rosterRow?.stations ?? 0}</p>
      </div>
     </div>

     <section>
      <h3 className="bb-section-title mb-2">Recent work</h3>
      {recent.length === 0 ? (
       <p className="text-sm text-[#8b939e]">No recent attributed sessions</p>
      ) : (
       <div className="bb-table-wrap">
        <table className="bb-table">
         <thead className="bb-table-head">
          <tr>
           <th>When</th>
           <th>Station</th>
           <th>Part</th>
           <th className="text-right">Dwell</th>
          </tr>
         </thead>
         <tbody>
          {recent.slice(0, 20).map((r, i) => (
           <tr key={i} className="bb-table-row">
            <td className="text-xs text-[#8b939e] whitespace-nowrap">{formatWhen(r.assigned_at)}</td>
            <td className="text-xs">{r.station_name || '—'}</td>
            <td className="font-mono text-[11px] text-[#8b939e] truncate max-w-[8rem]">{r.epc ?? '—'}</td>
            <td className="text-right font-mono text-xs">{r.dwell_display ?? '—'}</td>
           </tr>
          ))}
         </tbody>
        </table>
       </div>
      )}
     </section>
    </div>
   </aside>
  </div>
 )
}

/* ── Live tab ───────────────────────────────────────────────────────────────── */

function LiveTab({ tick }) {
 const [data, setData] = useState(null)
 const [error, setError] = useState(null)
 const [search, setSearch] = useState('')
 const [selectedId, setSelectedId] = useState(null)

 const load = useCallback(() => {
  loadLiveData()
   .then(d => { setData(d); setError(null) })
   .catch(e => setError(e?.message || 'Failed to load operators'))
 }, [])

 useEffect(() => {
  load()
  const id = setInterval(load, 60000)
  return () => clearInterval(id)
 }, [load, tick])

 const inZoneMap = useMemo(() => {
  const m = new Map()
  for (const z of data?.currently_in_zone ?? []) m.set(z.operator_id, z)
  return m
 }, [data])

 const leaderboardMap = useMemo(
  () => new Map((data?.leaderboard ?? []).map(o => [o.operator_id, o])),
  [data],
 )

 const rows = useMemo(() => {
  return (data?.roster ?? [])
   .filter(r => r.is_active !== false)
   .map(r => {
    const stats = leaderboardMap.get(r.operator_id)
    const zone = inZoneMap.get(r.operator_id)
    return {
     ...r,
     parts_today: r.parts_today ?? stats?.completed_pieces ?? 0,
     stations_today: r.stations_today ?? stats?.stations_worked ?? 0,
     in_progress: r.in_progress ?? stats?.in_progress ?? 0,
     current_station: zone?.station_name ?? null,
     status: zone ? 'Active' : 'Idle',
    }
   })
   .sort((a, b) => (b.parts_today - a.parts_today) || a.operator_name.localeCompare(b.operator_name))
 }, [data, leaderboardMap, inZoneMap])

 const filtered = useMemo(() => {
  if (!search.trim()) return rows
  const q = search.trim().toLowerCase()
  return rows.filter(c =>
   `${c.operator_name} ${c.rtls_badge_id} ${c.employee_number} ${c.current_station ?? ''}`.toLowerCase().includes(q),
  )
 }, [rows, search])

 const activeCount = data?.currently_in_zone?.length ?? rows.filter(r => r.status === 'Active').length

 if (!data && !error) {
  return <div className="bb-table-wrap animate-pulse"><div className="h-48 bg-[#16161a]" /></div>
 }

 return (
  <div className="space-y-4">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <p className="bb-page-sub">Who is working where right now?</p>
    </div>
    <div className="relative">
     <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#8b939e] pointer-events-none" />
     <input
      type="text"
      value={search}
      onChange={e => setSearch(e.target.value)}
      placeholder="Search operators…"
      className="bb-input pl-8 w-52"
     />
    </div>
   </div>

   {error && <p className="text-sm text-[#f87171]">{error}</p>}

   <p className="text-sm text-[#8b939e]">
    <span className="tabular-nums font-semibold text-[#eef2f7]">{activeCount}</span> active now
    <span className="mx-2 text-[#2a2a32]">|</span>
    <span className="tabular-nums">{rows.length} on roster</span>
   </p>

   {filtered.length === 0 ? (
    <p className="bb-empty">No operators match</p>
   ) : (
    <div className="bb-table-wrap">
     <table className="bb-table">
      <thead className="bb-table-head">
       <tr>
        <th>Operator</th>
        <th className="text-right">Badge</th>
        <th>Current station</th>
        <th className="text-right">Parts today</th>
        <th className="text-right">Stations today</th>
        <th>Status</th>
       </tr>
      </thead>
      <tbody>
       {filtered.map(op => (
        <tr
         key={op.operator_id}
         className={`bb-table-row cursor-pointer ${selectedId === op.operator_id ? 'bb-table-row-active' : ''}`}
         onClick={() => setSelectedId(op.operator_id)}
        >
         <td className="font-medium text-[#eef2f7]">{op.operator_name}</td>
         <td className="text-right font-mono text-xs tabular-nums text-[#8b939e]">
          {op.rtls_badge_id ?? '—'}
         </td>
         <td className="text-[#8b939e]">{op.current_station ?? '—'}</td>
         <td className="text-right tabular-nums font-semibold">{op.parts_today}</td>
         <td className="text-right tabular-nums text-[#8b939e]">{op.stations_today}</td>
         <td>
          {op.status === 'Active' ? (
           <span className="inline-flex items-center gap-1.5">
            <span className="bb-status-dot bg-[#34d399]" />
            <span className="text-[#34d399] text-xs font-medium">Active</span>
           </span>
          ) : (
           <span className="inline-flex items-center gap-1.5">
            <span className="bb-status-dot bg-[#8b939e]" />
            <span className="text-[#8b939e] text-xs">Idle</span>
           </span>
          )}
         </td>
        </tr>
       ))}
      </tbody>
     </table>
    </div>
   )}

   <p className="text-[11px] text-[#8b939e]">
    Parts today = unique parts with a completed RFID session attributed to the operator today.
   </p>

   {selectedId != null && (
    <LiveDrawer
     operatorId={selectedId}
     rosterRow={rows.find(c => c.operator_id === selectedId)}
     inZoneProp={inZoneMap.get(selectedId)}
     onClose={() => setSelectedId(null)}
     tick={tick}
    />
   )}
  </div>
 )
}

/* ── Trends tab ─────────────────────────────────────────────────────────────── */

const SUMMARY_ROWS = [
 { key: 'parts_per_active_hour', label: 'Parts completed/hour' },
 { key: 'median_operator_dwell_seconds', label: 'Median operator dwell' },
 { key: 'parts_over_target_pct', label: 'Parts over target' },
 { key: 'active_station_seconds', label: 'Active station time' },
 { key: 'rfid_associated_parts', label: 'RFID-associated parts' },
]

function TrendsTab({ tick }) {
 const [operators, setOperators] = useState([])
 const [operatorId, setOperatorId] = useState('')
 const [range, setRange] = useState('14')
 const [station, setStation] = useState('')
 const [workOrder, setWorkOrder] = useState('')
 const [partType, setPartType] = useState('')
 const [metric, setMetric] = useState('parts_per_active_hour')
 const [data, setData] = useState(null)
 const [error, setError] = useState(null)
 const [loading, setLoading] = useState(false)
 const [dayDrill, setDayDrill] = useState(null)
 const [daySessions, setDaySessions] = useState([])

 useEffect(() => {
  apiFetch('/api/operators')
   .then(list => {
    const active = (list || []).filter(o => o.is_active !== false)
    setOperators(active)
    if (!operatorId && active.length) {
     setOperatorId(String(active[0].operator_id))
    }
   })
   .catch(() => setOperators([]))
 }, []) // eslint-disable-line react-hooks/exhaustive-deps

 const loadTrends = useCallback(() => {
  if (!operatorId) return
  setLoading(true)
  const params = new URLSearchParams({
   operator_id: operatorId,
   days: String(range),
   metric,
  })
  if (station) params.set('station', station)
  if (workOrder) params.set('work_order', workOrder)
  if (partType) params.set('part_type', partType)
  apiFetch(`/api/analytics/operators/trends?${params}`)
   .then(d => {
    setData(d)
    setError(null)
   })
   .catch(e => setError(e?.message || 'Failed to load trends'))
   .finally(() => setLoading(false))
 }, [operatorId, range, station, workOrder, partType, metric])

 useEffect(() => {
  loadTrends()
 }, [loadTrends, tick])

 const openDay = async (row) => {
  setDayDrill(row)
  setDaySessions([])
  try {
   const params = new URLSearchParams({
    operator_id: operatorId,
    date: row.date,
   })
   if (row.station) params.set('station', row.station)
   const res = await apiFetch(`/api/analytics/operators/trends/sessions?${params}`)
   setDaySessions(res.sessions ?? [])
  } catch {
   setDaySessions([])
  }
 }

 const op = data?.operator
 const summary = data?.summary ?? {}
 const opts = data?.filter_options ?? {}
 const peerCount = data?.filters?.peer_count ?? 0
 const stationLabel = data?.filters?.station || station || 'selected station'
 const rangeLabel = RANGE_PRESETS.find(p => p.id === range)?.label || 'selected period'
 const dateFrom = data?.filters?.date_from
 const dateTo = data?.filters?.date_to

 const weekdayPrimary = (data?.by_weekday ?? []).map(d => ({
  label: d.label,
  short: d.label,
  value: d.operator_value ?? 0,
  samples: d.samples ?? 0,
 }))
 const weekdayPeer = (data?.by_weekday ?? []).map(d => ({
  label: d.label,
  value: d.peer_value,
 }))
 const hasWeekdayData = (data?.by_weekday ?? []).some(
  d => d.operator_value != null || d.peer_value != null,
 )

 const peerBars = (data?.peers ?? []).map(p => ({
  label: p.operator_name,
  value: p.value ?? 0,
  display: formatMetricValue(metric, p.value),
  highlight: p.is_selected,
  is_selected: p.is_selected,
  is_median: p.is_median,
 }))

 const metricLabel = (opts.metrics ?? []).find(m => m.id === metric)?.label
  || 'Parts per active hour'

 return (
  <div className="space-y-5">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <p className="bb-page-sub">
     Average performance by weekday, compared with others at the same station.
    </p>
    <div className="flex gap-0.5 p-0.5 rounded-[6px] bg-[#08080a] border border-[#2a2a32]">
     {RANGE_PRESETS.map(p => (
      <button
       key={p.id}
       type="button"
       onClick={() => setRange(p.id)}
       className={`px-2.5 py-1.5 rounded-[4px] text-xs font-medium transition-colors whitespace-nowrap
        ${range === p.id
         ? 'bg-[#4dc4f4] text-[#08080a]'
         : 'text-[#8b939e] hover:text-[#eef2f7]'}`}
      >
       {p.label}
      </button>
     ))}
    </div>
   </div>

   {/* Filters */}
   <div className="bb-panel px-3 py-3">
    <div className="flex flex-wrap items-end gap-3">
     <label className="space-y-1 text-xs text-[#8b939e]">
      <span className="uppercase tracking-wider">Operator</span>
      <select
       className="bb-input block min-w-[12rem]"
       value={operatorId}
       onChange={e => { setOperatorId(e.target.value); setStation('') }}
      >
       <option value="">Select…</option>
       {operators.map(o => (
        <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>
       ))}
      </select>
     </label>

     <label className="space-y-1 text-xs text-[#8b939e]">
      <span className="uppercase tracking-wider">Station</span>
      <select
       className="bb-input block min-w-[10rem]"
       value={station || data?.filters?.station || ''}
       onChange={e => setStation(e.target.value)}
      >
       {(opts.stations?.length
        ? opts.stations
        : (data?.filters?.station ? [data.filters.station] : [])
       ).map(s => (
        <option key={s} value={s}>
         {s}{s === data?.operator?.primary_station ? ' (primary)' : ''}
        </option>
       ))}
      </select>
     </label>

     <label className="space-y-1 text-xs text-[#8b939e]">
      <span className="uppercase tracking-wider">Metric</span>
      <select
       className="bb-input block min-w-[11rem]"
       value={metric}
       onChange={e => setMetric(e.target.value)}
      >
       {(opts.metrics ?? [
        { id: 'parts_per_active_hour', label: 'Parts per active hour' },
       ]).map(m => (
        <option key={m.id} value={m.id}>{m.label}</option>
       ))}
      </select>
     </label>

     <label className="space-y-1 text-xs text-[#8b939e]">
      <span className="uppercase tracking-wider">Work order</span>
      <select
       className="bb-input block min-w-[9rem]"
       value={workOrder}
       onChange={e => setWorkOrder(e.target.value)}
      >
       <option value="">All</option>
       {(opts.work_orders ?? []).map(w => (
        <option key={w} value={w}>{w}</option>
       ))}
      </select>
     </label>

     <label className="space-y-1 text-xs text-[#8b939e]">
      <span className="uppercase tracking-wider">Part type</span>
      <select
       className="bb-input block min-w-[8rem]"
       value={partType}
       onChange={e => setPartType(e.target.value)}
      >
       <option value="">All</option>
       {(opts.part_types ?? []).map(t => (
        <option key={t} value={t}>{t}</option>
       ))}
      </select>
     </label>
    </div>
   </div>

   {error && <p className="text-sm text-[#f87171]">{error}</p>}
   {loading && !data && (
    <div className="bb-table-wrap animate-pulse"><div className="h-32 bg-[#16161a]" /></div>
   )}

   {op && (
    <>
     <div>
      <h2 className="text-lg font-semibold text-[#eef2f7]">{op.operator_name}</h2>
      <p className="text-sm text-[#8b939e]">
       {op.rtls_badge_id != null ? `Badge ${op.rtls_badge_id}` : 'No badge'}
       {' · '}{stationLabel}
       {' · '}{op.active_days ?? 0} active days
       {dateFrom && dateTo ? ` · ${dateFrom} → ${dateTo}` : ''}
       {' · '}{rangeLabel}
      </p>
      {peerCount < 1 && (
       <p className="text-[11px] text-[#fbbf24] mt-1">
        No other operators at {stationLabel} in this period — peer comparison unavailable.
       </p>
      )}
     </div>

     {/* Mon–Sun averages */}
     <section className="bb-section">
      <h3 className="bb-section-title">
       Average by day of week — vs {stationLabel}
      </h3>
      <div className="bb-panel px-4 py-4">
       {!hasWeekdayData ? (
        <p className="bb-empty">No weekday averages in this range</p>
       ) : (
        <VerticalBars
         data={weekdayPrimary}
         compareData={weekdayPeer}
         formatValue={v => formatMetricValue(metric, v)}
         primaryLabel={op.operator_name}
         compareLabel={`${stationLabel} average`}
        />
       )}
      </div>
      <div className="bb-table-wrap mt-3">
       <table className="bb-table">
        <thead className="bb-table-head">
         <tr>
          <th>Day</th>
          <th className="text-right">Operator avg</th>
          <th className="text-right">Station avg</th>
          <th className="text-right">Difference</th>
          <th className="text-right">Samples</th>
         </tr>
        </thead>
        <tbody>
         {(data?.by_weekday ?? []).map(row => {
          const opV = row.operator_value
          const peerV = row.peer_value
          const delta = opV != null && peerV != null ? opV - peerV : null
          return (
           <tr key={row.weekday} className="bb-table-row">
            <td className="font-medium text-[#eef2f7]">{row.label}</td>
            <td className="text-right font-mono tabular-nums font-semibold">
             {opV != null ? formatMetricValue(metric, opV) : '—'}
            </td>
            <td className="text-right font-mono tabular-nums text-[#8b939e]">
             {peerV != null ? formatMetricValue(metric, peerV) : '—'}
            </td>
            <td className={`text-right font-mono tabular-nums ${
             delta > 0 ? 'text-[#34d399]' : delta < 0 ? 'text-[#fbbf24]' : 'text-[#8b939e]'
            }`}>
             {delta == null
              ? '—'
              : `${delta > 0 ? '+' : ''}${formatMetricValue(metric, delta)}`}
            </td>
            <td className="text-right tabular-nums text-[#8b939e]">{row.samples ?? 0}</td>
           </tr>
          )
         })}
        </tbody>
       </table>
      </div>
      <p className="text-[11px] text-[#8b939e]">
       Each cell is the average of that weekday across the selected period
       (e.g. all Mondays in {rangeLabel.toLowerCase()}). Station average is other operators
       at {stationLabel} on those same weekdays. Metric: {metricLabel}.
      </p>
     </section>

     {/* Summary vs peers */}
     <section className="bb-section">
      <h3 className="bb-section-title">Period summary vs {stationLabel}</h3>
      <div className="bb-table-wrap">
       <table className="bb-table">
        <thead className="bb-table-head">
         <tr>
          <th>Metric</th>
          <th className="text-right">Operator</th>
          <th className="text-right">Peer average</th>
          <th className="text-right">Difference</th>
         </tr>
        </thead>
        <tbody>
         {SUMMARY_ROWS.map(row => {
          const m = summary[row.key] || {}
          return (
           <tr key={row.key} className="bb-table-row">
            <td className="text-[#eef2f7]">{row.label}</td>
            <td className="text-right font-mono tabular-nums font-semibold">{m.display ?? '—'}</td>
            <td className="text-right font-mono tabular-nums text-[#8b939e]">{m.peer_display ?? '—'}</td>
            <td className={`text-right font-mono tabular-nums ${
             m.delta > 0 ? 'text-[#34d399]' : m.delta < 0 ? 'text-[#fbbf24]' : 'text-[#8b939e]'
            }`}>
             {m.delta_display ?? '—'}
            </td>
           </tr>
          )
         })}
        </tbody>
       </table>
      </div>
     </section>

     {/* Operator ranking at station */}
     <section className="bb-section">
      <h3 className="bb-section-title">
       How does {op.operator_name} compare at {stationLabel}?
      </h3>
      <div className="bb-panel px-4 py-4 max-w-xl">
       <HorizontalBars
        data={peerBars}
        formatValue={v => formatMetricValue(metric, v)}
        emptyText="No peer data at this station"
       />
      </div>
      <p className="text-[11px] text-[#8b939e]">
       Ranking by {metricLabel} for all operators with activity at {stationLabel} in this period.
      </p>
     </section>

     {/* Station breakdown */}
     <section className="bb-section">
      <h3 className="bb-section-title">Station breakdown</h3>
      {(data?.stations ?? []).length === 0 ? (
       <p className="bb-empty">No station activity in this range</p>
      ) : (
       <div className="bb-table-wrap">
        <table className="bb-table">
         <thead className="bb-table-head">
          <tr>
           <th>Station</th>
           <th className="text-right">Sessions</th>
           <th className="text-right">Parts</th>
           <th className="text-right">Parts/hour</th>
           <th className="text-right">Median dwell</th>
           <th className="text-right">Within target</th>
          </tr>
         </thead>
         <tbody>
          {data.stations.map(s => (
           <tr key={s.station} className="bb-table-row">
            <td className="font-medium text-[#eef2f7]">{s.station}</td>
            <td className="text-right tabular-nums">{s.sessions}</td>
            <td className="text-right tabular-nums">{s.parts}</td>
            <td className="text-right font-mono tabular-nums">
             {s.parts_per_active_hour != null ? s.parts_per_active_hour.toFixed(1) : '—'}
            </td>
            <td className="text-right font-mono text-xs text-[#8b939e]">
             {s.median_dwell_display ?? '—'}
            </td>
            <td className="text-right tabular-nums">
             {s.within_target_pct != null ? `${s.within_target_pct}%` : '—'}
            </td>
           </tr>
          ))}
         </tbody>
        </table>
       </div>
      )}
     </section>

     {/* Daily history */}
     <section className="bb-section">
      <h3 className="bb-section-title">Daily history</h3>
      {(data?.days ?? []).length === 0 ? (
       <p className="bb-empty">No daily rows in this range</p>
      ) : (
       <div className="bb-table-wrap">
        <table className="bb-table">
         <thead className="bb-table-head">
          <tr>
           <th>Date</th>
           <th>Day</th>
           <th>Station</th>
           <th className="text-right">Active time</th>
           <th className="text-right">Parts</th>
           <th className="text-right">Parts/hour</th>
           <th className="text-right">Median dwell</th>
           <th className="text-right">Over target</th>
          </tr>
         </thead>
         <tbody>
          {data.days.map((row, i) => (
           <tr
            key={`${row.date}-${row.station}-${i}`}
            className="bb-table-row cursor-pointer"
            onClick={() => openDay(row)}
           >
            <td className="whitespace-nowrap">{row.label || row.date}</td>
            <td className="text-[#8b939e]">{row.weekday ?? '—'}</td>
            <td className="text-[#8b939e]">{row.station}</td>
            <td className="text-right font-mono text-xs">{row.active_display ?? '—'}</td>
            <td className="text-right tabular-nums font-semibold">{row.parts}</td>
            <td className="text-right font-mono tabular-nums">
             {row.parts_per_active_hour != null ? row.parts_per_active_hour.toFixed(1) : '—'}
            </td>
            <td className="text-right font-mono text-xs text-[#8b939e]">
             {row.median_dwell_display ?? '—'}
            </td>
            <td className="text-right tabular-nums text-[#8b939e]">{row.over_target ?? 0}</td>
           </tr>
          ))}
         </tbody>
        </table>
       </div>
      )}
      <p className="text-[11px] text-[#8b939e]">Click a day to see the sessions used in the calculation.</p>
     </section>
    </>
   )}

   {!operatorId && (
    <p className="bb-empty">Select an operator to view trends</p>
   )}

   {dayDrill && (
    <div className="bb-drawer-backdrop" onClick={() => setDayDrill(null)}>
     <aside className="bb-drawer" onClick={e => e.stopPropagation()}>
      <div className="bb-panel-header border-b border-[#2a2a32]">
       <div>
        <h2 className="bb-title">{dayDrill.label || dayDrill.date}</h2>
        <p className="bb-subtitle">{dayDrill.station} · session detail</p>
       </div>
       <button type="button" onClick={() => setDayDrill(null)} className="bb-btn-ghost p-1.5">
        <X className="w-4 h-4" />
       </button>
      </div>
      <div className="p-4 overflow-y-auto flex-1">
       {daySessions.length === 0 ? (
        <p className="text-sm text-[#8b939e]">No sessions for this day</p>
       ) : (
        <div className="bb-table-wrap">
         <table className="bb-table">
          <thead className="bb-table-head">
           <tr>
            <th>When</th>
            <th>Part</th>
            <th>WO</th>
            <th className="text-right">Dwell</th>
            <th>Status</th>
           </tr>
          </thead>
          <tbody>
           {daySessions.map((s, i) => (
            <tr key={i} className="bb-table-row">
             <td className="text-xs text-[#8b939e] whitespace-nowrap">
              {formatWhen(s.exit_time || s.assigned_at)}
             </td>
             <td className="font-mono text-[11px] truncate max-w-[8rem]">{s.epc ?? '—'}</td>
             <td className="font-mono text-[11px] text-[#8b939e]">{s.ibus_number ?? '—'}</td>
             <td className="text-right font-mono text-xs">{s.dwell_display ?? '—'}</td>
             <td className="text-xs text-[#8b939e]">{s.session_status}</td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
       )}
      </div>
     </aside>
    </div>
   )}
  </div>
 )
}

/* ── Page shell ─────────────────────────────────────────────────────────────── */

export function OperatorAnalyticsPage({ tick = 0 }) {
 const [tab, setTab] = useState('live')

 return (
  <div className="space-y-4">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <h1 className="bb-page-title">Operators</h1>
    </div>
    <div className="flex gap-1">
     {TABS.map(t => (
      <button
       key={t.id}
       type="button"
       onClick={() => setTab(t.id)}
       className={`bb-btn-outline ${tab === t.id ? 'bb-btn-outline-active' : ''}`}
      >
       {t.label}
      </button>
     ))}
    </div>
   </div>

   {tab === 'live' ? <LiveTab tick={tick} /> : <TrendsTab tick={tick} />}
  </div>
 )
}
