import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { apiFetch } from '../api'
import { VerticalBars, HorizontalBars } from '../components/charts'

const TABS = [
 { id: 'live', label: 'Live' },
 { id: 'trends', label: 'Trends' },
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

function formatDwell(sec) {
 if (sec == null || Number.isNaN(sec)) return '—'
 const s = Math.round(sec)
 if (s < 60) return `${s}s`
 const m = Math.floor(s / 60)
 const r = s % 60
 if (m < 60) return r ? `${m}m ${r}s` : `${m}m`
 const h = Math.floor(m / 60)
 return `${h}h ${m % 60}m`
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

const RANGE_PRESETS = [
 { id: '7', label: 'Last week' },
 { id: '14', label: 'Last 2 weeks' },
 { id: '30', label: 'Last 30 days' },
 { id: '90', label: 'Last 90 days' },
 { id: 'all', label: 'All time' },
]

const COMPARE_OPTIONS = [
 { id: 'expected_target', label: 'Expected target' },
 { id: 'all_average', label: 'All operators average' },
 { id: 'operator', label: 'Another operator' },
]

function dwellDeltaClass(delta) {
 if (delta == null || delta === 0) return 'text-[#8b939e]'
 return delta < 0 ? 'text-[#34d399]' : 'text-[#fbbf24]'
}

function formatDwellDelta(delta) {
 if (delta == null) return '—'
 if (delta === 0) return '0'
 const sign = delta > 0 ? '+' : '-'
 return `${sign}${formatDwell(Math.abs(delta))}`
}

function partsDeltaClass(delta) {
 if (delta == null || delta === 0) return 'text-[#8b939e]'
 return delta > 0 ? 'text-[#34d399]' : 'text-[#fbbf24]'
}

function WeekdayCompareSection({
 title,
 subtitle,
 footnote,
 operatorName,
 compareLabel,
 rows,
 operatorValue,
 peerValue,
 formatValue,
 formatDelta,
 deltaClass,
 hasCompare = true,
 machineFilter,
}) {
 const chartData = rows.map(d => ({
  label: d.label,
  short: d.label,
  value: operatorValue(d) ?? 0,
 }))
 const compareData = hasCompare
  ? rows.map(d => ({ label: d.label, value: peerValue(d) }))
  : null
 const hasData = rows.some(d => operatorValue(d) != null || (hasCompare && peerValue(d) != null))

 return (
  <section className="bb-section">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <h3 className="bb-section-title">{title}</h3>
     <p className="text-[11px] text-[#8b939e] mt-0.5">{subtitle}</p>
    </div>
    {machineFilter}
   </div>
   <div className="bb-panel px-4 py-4">
    {!hasData ? (
     <p className="bb-empty">No data in this period</p>
    ) : (
     <VerticalBars
      data={chartData}
      compareData={compareData}
      formatValue={formatValue}
      primaryLabel={operatorName}
      compareLabel={compareLabel}
     />
    )}
   </div>
   {hasData && (
    <div className="bb-table-wrap mt-3">
     <table className="bb-table">
      <thead className="bb-table-head">
       <tr>
        <th>Day</th>
        <th className="text-right">{operatorName}</th>
        {hasCompare && <th className="text-right">{compareLabel}</th>}
        {hasCompare && <th className="text-right">Difference</th>}
        <th className="text-right">Days sampled</th>
       </tr>
      </thead>
      <tbody>
       {rows.map(row => {
        const opV = operatorValue(row)
        const cmpV = hasCompare ? peerValue(row) : null
        const delta = opV != null && cmpV != null ? opV - cmpV : null
        return (
         <tr key={row.weekday} className="bb-table-row">
          <td className="font-medium text-[#eef2f7]">{row.label}</td>
          <td className="text-right font-mono tabular-nums font-semibold">
           {opV != null ? formatValue(opV) : '—'}
          </td>
          {hasCompare && (
           <td className="text-right font-mono tabular-nums text-[#8b939e]">
            {cmpV != null ? formatValue(cmpV) : '—'}
           </td>
          )}
          {hasCompare && (
           <td className={`text-right font-mono tabular-nums font-semibold ${deltaClass(delta)}`}>
            {delta == null ? '—' : formatDelta(delta)}
           </td>
          )}
          <td className="text-right tabular-nums text-[#8b939e]">{row.samples ?? 0}</td>
         </tr>
        )
       })}
      </tbody>
     </table>
    </div>
   )}
   {footnote && <p className="text-[11px] text-[#8b939e]">{footnote}</p>}
  </section>
 )
}

function SelectField({ label, value, onChange, children, className = '' }) {
 return (
  <label className={`space-y-1 text-xs text-[#8b939e] ${className}`}>
   <span className="uppercase tracking-wider font-semibold">{label}</span>
   <select className="bb-input block w-full min-w-[10rem]" value={value} onChange={onChange}>
    {children}
   </select>
  </label>
 )
}

function TrendsTab({ tick }) {
 const [operators, setOperators] = useState([])
 const [operatorId, setOperatorId] = useState('')
 const [compareMode, setCompareMode] = useState('expected_target')
 const [compareOperatorId, setCompareOperatorId] = useState('')
 const [range, setRange] = useState('30')
 const [partsMachine, setPartsMachine] = useState('all')
 const [dwellMachine, setDwellMachine] = useState('all')
 const [partType, setPartType] = useState('')
 const [series, setSeries] = useState('')
 const [drawing, setDrawing] = useState('')
 const [data, setData] = useState(null)
 const [error, setError] = useState(null)
 const [loading, setLoading] = useState(false)

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

 useEffect(() => {
  if (compareMode !== 'operator' || compareOperatorId) return
  const first = operators.find(o => String(o.operator_id) !== String(operatorId))
  if (first) setCompareOperatorId(String(first.operator_id))
 }, [compareMode, compareOperatorId, operators, operatorId])

 const loadTrends = useCallback(() => {
  if (!operatorId) return
  setLoading(true)
  const params = new URLSearchParams({
   operator_id: operatorId,
   days: String(range),
   metric: 'avg_part_dwell',
   compare_mode: compareMode,
  })
  if (partType) params.set('part_type', partType)
  if (series) params.set('series', series)
  if (drawing) params.set('drawing', drawing)
  if (compareMode === 'operator' && compareOperatorId) {
   params.set('compare_operator_id', compareOperatorId)
  }
  apiFetch(`/api/analytics/operators/trends?${params}`)
   .then(d => {
    setData(d)
    setError(null)
   })
   .catch(e => setError(e?.message || 'Failed to load trends'))
   .finally(() => setLoading(false))
 }, [operatorId, range, partType, series, drawing, compareMode, compareOperatorId])

 useEffect(() => {
  loadTrends()
 }, [loadTrends, tick])

 const op = data?.operator
 const compareLabel = data?.filters?.compare_label || 'Compare'
 const rangeLabel = RANGE_PRESETS.find(p => p.id === range)?.label || 'Selected period'
 const dateFrom = data?.filters?.date_from
 const dateTo = data?.filters?.date_to

 const stationOptions = useMemo(() => {
  const fromApi = data?.filter_options?.stations ?? []
  if (fromApi.length) return fromApi
  return (data?.stations ?? []).map(s => s.station)
 }, [data])

 const partTypeOptions = data?.filter_options?.part_types ?? []
 const seriesOptions = data?.filter_options?.series ?? []
 const drawingOptions = data?.filter_options?.drawings ?? []

 const partFilterLabel = useMemo(() => {
  if (drawing) return drawing
  if (series) return `Series ${series}`
  if (partType) return partType
  return 'All parts'
 }, [drawing, series, partType])

 const weekdayByStation = data?.by_weekday_by_station ?? {}

 const partsWeekdayRows = useMemo(() => {
  if (partsMachine === 'all') return data?.by_weekday ?? []
  return weekdayByStation[partsMachine] ?? []
 }, [data, partsMachine, weekdayByStation])

 const dwellWeekdayRows = useMemo(() => {
  if (dwellMachine === 'all') return data?.by_weekday ?? []
  return weekdayByStation[dwellMachine] ?? []
 }, [data, dwellMachine, weekdayByStation])

 const partsCompareAvailable = compareMode !== 'expected_target'

 const machineFilterSelect = (value, onChange, allLabel) => (
  <SelectField label="Machine" value={value} onChange={onChange} className="min-w-[11rem]">
   <option value="all">{allLabel}</option>
   {stationOptions.map(s => (
    <option key={s} value={s}>{s}</option>
   ))}
  </SelectField>
 )

 const partsMachineLabel = partsMachine === 'all'
  ? 'all stations'
  : partsMachine
 const dwellMachineLabel = dwellMachine === 'all'
  ? 'all stations'
  : dwellMachine

 const stationPartsBars = useMemo(() => (
  (data?.stations ?? []).map(s => ({
   label: s.station,
   value: s.parts ?? 0,
   display: `${s.parts ?? 0} parts`,
  }))
 ), [data])
 const stationDwellCompare = useMemo(() => (
  (data?.stations ?? []).map(s => ({
   label: s.station,
   value: s.avg_part_dwell_seconds ?? 0,
   target: s.compare_part_dwell_seconds
    ?? s.target_part_dwell_seconds
    ?? s.peer_avg_part_dwell_seconds,
   display: `${s.avg_part_dwell_display ?? '—'} vs ${s.compare_part_dwell_display ?? s.target_part_dwell_display ?? '—'}`,
  }))
 ), [data])

 const compareOperators = operators.filter(
  o => String(o.operator_id) !== String(operatorId),
 )

 const formatParts = v => `${Math.round(v)}`

 const formatPartsDelta = delta => {
  if (delta == null) return '—'
  if (delta === 0) return '0'
  return `${delta > 0 ? '+' : ''}${Math.round(delta)}`
 }

 return (
  <div className="space-y-5">
   {/* Controls */}
   <div className="bb-panel px-4 py-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
     <SelectField
      label="Operator"
      value={operatorId}
      onChange={e => setOperatorId(e.target.value)}
     >
      <option value="">Select…</option>
      {operators.map(o => (
       <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>
      ))}
     </SelectField>

     <SelectField
      label="Compare to"
      value={compareMode}
      onChange={e => setCompareMode(e.target.value)}
     >
      {COMPARE_OPTIONS.map(o => (
       <option key={o.id} value={o.id}>{o.label}</option>
      ))}
     </SelectField>

     {compareMode === 'operator' && (
      <SelectField
       label="Compare operator"
       value={compareOperatorId}
       onChange={e => setCompareOperatorId(e.target.value)}
      >
       <option value="">Select…</option>
       {compareOperators.map(o => (
        <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>
       ))}
      </SelectField>
     )}

     <SelectField
      label="Time period"
      value={range}
      onChange={e => setRange(e.target.value)}
     >
      {RANGE_PRESETS.map(p => (
       <option key={p.id} value={p.id}>{p.label}</option>
      ))}
     </SelectField>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3 pt-3 border-t border-[#2a2a32]">
     <SelectField
      label="Part type"
      value={partType}
      onChange={e => setPartType(e.target.value)}
     >
      <option value="">All part types</option>
      {partTypeOptions.map(t => (
       <option key={t} value={t}>{t}</option>
      ))}
     </SelectField>

     <SelectField
      label="Series"
      value={series}
      onChange={e => { setSeries(e.target.value); setDrawing('') }}
     >
      <option value="">All series</option>
      {seriesOptions.map(s => (
       <option key={s} value={s}>{s}</option>
      ))}
     </SelectField>

     <SelectField
      label="Drawing"
      value={drawing}
      onChange={e => setDrawing(e.target.value)}
     >
      <option value="">All drawings</option>
      {drawingOptions.map(d => (
       <option key={d} value={d}>{d}</option>
      ))}
     </SelectField>
    </div>
   </div>

   {error && <p className="text-sm text-[#f87171]">{error}</p>}
   {loading && !data && (
    <div className="bb-table-wrap animate-pulse"><div className="h-32 bg-[#16161a]" /></div>
   )}

   {!operatorId && (
    <p className="bb-empty">Select an operator to view trends</p>
   )}

   {op && (
    <>
     <div>
      <h2 className="text-lg font-semibold text-[#eef2f7]">{op.operator_name}</h2>
      <p className="text-sm text-[#8b939e]">
       {partFilterLabel}
       {' · '}{rangeLabel}
       {dateFrom && dateTo ? ` · ${dateFrom} → ${dateTo}` : ''}
       {' · '}{op.active_days ?? 0} active days
      </p>
     </div>

     <WeekdayCompareSection
      title="Parts by day of week"
      subtitle={
       partsCompareAvailable
        ? `Total parts on each weekday (${partsMachineLabel}) vs ${compareLabel.toLowerCase()}`
        : `Total parts on each weekday (${partsMachineLabel})`
      }
      footnote={
       partsCompareAvailable
        ? 'Higher is better. Green difference means more parts than the comparison.'
        : undefined
      }
      operatorName={op.operator_name}
      compareLabel={compareLabel}
      rows={partsWeekdayRows}
      operatorValue={row => row.operator_parts}
      peerValue={row => row.peer_parts}
      formatValue={formatParts}
      formatDelta={formatPartsDelta}
      deltaClass={partsDeltaClass}
      hasCompare={partsCompareAvailable}
      machineFilter={machineFilterSelect(
       partsMachine,
       e => setPartsMachine(e.target.value),
       'All total parts',
      )}
     />

     <WeekdayCompareSection
      title="Avg dwell by day of week"
      subtitle={`Average time per part on each weekday (${dwellMachineLabel}) vs ${compareLabel.toLowerCase()}`}
      footnote={`Lower dwell is better. Green difference means faster than ${compareLabel.toLowerCase()}.`}
      operatorName={op.operator_name}
      compareLabel={compareLabel}
      rows={dwellWeekdayRows}
      operatorValue={row => row.operator_value}
      peerValue={row => row.peer_value}
      formatValue={formatDwell}
      formatDelta={formatDwellDelta}
      deltaClass={dwellDeltaClass}
      machineFilter={machineFilterSelect(
       dwellMachine,
       e => setDwellMachine(e.target.value),
       'All stations',
      )}
     />

     {/* Station breakdown — hidden when comparing to another operator */}
     {compareMode !== 'operator' && (
     <section className="bb-section">
      <div>
       <h3 className="bb-section-title">By station</h3>
       <p className="text-[11px] text-[#8b939e] mt-0.5">
        Parts completed and avg dwell vs {compareLabel.toLowerCase()}
        {partFilterLabel !== 'All parts' ? ` · ${partFilterLabel}` : ''}
       </p>
      </div>

      {(data?.stations ?? []).length === 0 ? (
       <p className="bb-empty">No station activity for this filter</p>
      ) : (
       <>
        <div className="grid gap-4 lg:grid-cols-2">
         <div className="bb-panel px-4 py-4">
          <p className="text-[10px] uppercase tracking-wider text-[#8b939e] mb-3 font-semibold">
           Parts completed
          </p>
          <HorizontalBars
           data={stationPartsBars}
           formatValue={v => `${Math.round(v)} parts`}
           emptyText="No station activity"
          />
         </div>
         <div className="bb-panel px-4 py-4">
          <p className="text-[10px] uppercase tracking-wider text-[#8b939e] mb-3 font-semibold">
           Avg dwell vs {compareLabel.toLowerCase()}
          </p>
          <HorizontalBars
           data={stationDwellCompare}
           ratioMode
           formatValue={formatDwell}
           emptyText="No dwell data"
          />
         </div>
        </div>

        <div className="bb-table-wrap mt-3">
         <table className="bb-table">
          <thead className="bb-table-head">
           <tr>
            <th>Station</th>
            <th className="text-right">Avg dwell</th>
            <th className="text-right">{compareLabel}</th>
            <th className="text-right">Difference</th>
            <th className="text-right">Within target</th>
            <th className="text-right">Pieces</th>
           </tr>
          </thead>
          <tbody>
           {(data?.stations ?? []).map(s => {
            const cmp = s.compare_part_dwell_seconds
             ?? s.target_part_dwell_seconds
             ?? s.peer_avg_part_dwell_seconds
            const delta = s.avg_part_dwell_seconds != null && cmp != null
             ? s.avg_part_dwell_seconds - cmp
             : null
            return (
             <tr key={s.station} className="bb-table-row">
              <td className="font-medium text-[#eef2f7]">{s.station}</td>
              <td className="text-right font-mono text-xs tabular-nums font-semibold">
               {s.avg_part_dwell_display ?? '—'}
              </td>
              <td className="text-right font-mono text-xs tabular-nums text-[#8b939e]">
               {s.compare_part_dwell_display
                ?? s.target_part_dwell_display
                ?? s.peer_avg_part_dwell_display ?? '—'}
              </td>
              <td className={`text-right font-mono text-xs tabular-nums font-semibold ${dwellDeltaClass(delta)}`}>
               {delta == null ? '—' : formatDwellDelta(delta)}
              </td>
              <td className="text-right tabular-nums text-[#8b939e]">
               {s.within_target_pct != null ? `${s.within_target_pct}%` : '—'}
              </td>
              <td className="text-right tabular-nums text-[#8b939e]">{s.parts ?? 0}</td>
             </tr>
            )
           })}
          </tbody>
         </table>
        </div>
       </>
      )}
     </section>
     )}

     {/* Period summary — parts and dwell */}
     <section className="bb-section">
      <h3 className="bb-section-title mb-3">Period summary</h3>
      <div className="grid gap-4 lg:grid-cols-2">
       <div className="bb-panel px-4 py-4 space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-[#8b939e] font-semibold">Parts</p>
        <div className="bb-kpi-strip">
         <div>
          <p className="bb-kpi-label">{op.operator_name}</p>
          <p className="bb-kpi-value">
           {data?.summary?.rfid_associated_parts?.display ?? '—'}
          </p>
         </div>
         {partsCompareAvailable && (
          <>
           <div>
            <p className="bb-kpi-label">{compareLabel}</p>
            <p className="bb-kpi-value text-[#8b939e]">
             {data?.summary?.rfid_associated_parts?.peer_display ?? '—'}
            </p>
           </div>
           <div>
            <p className="bb-kpi-label">Difference</p>
            <p className={`bb-kpi-value ${partsDeltaClass(data?.summary?.rfid_associated_parts?.delta)}`}>
             {data?.summary?.rfid_associated_parts?.delta_display ?? '—'}
            </p>
           </div>
          </>
         )}
        </div>
        <p className="text-[11px] text-[#8b939e]">{rangeLabel}</p>
       </div>

       <div className="bb-panel px-4 py-4 space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-[#8b939e] font-semibold">Avg dwell</p>
        <div className="bb-kpi-strip">
         <div>
          <p className="bb-kpi-label">{op.operator_name}</p>
          <p className="bb-kpi-value">
           {data?.summary?.avg_part_dwell_seconds?.display ?? '—'}
          </p>
         </div>
         <div>
          <p className="bb-kpi-label">{compareLabel}</p>
          <p className="bb-kpi-value text-[#8b939e]">
           {data?.summary?.avg_part_dwell_seconds?.peer_display ?? '—'}
          </p>
         </div>
         <div>
          <p className="bb-kpi-label">Difference</p>
          <p className={`bb-kpi-value ${dwellDeltaClass(data?.summary?.avg_part_dwell_seconds?.delta)}`}>
           {data?.summary?.avg_part_dwell_seconds?.delta_display ?? '—'}
          </p>
         </div>
        </div>
        <p className="text-[11px] text-[#8b939e]">{rangeLabel}</p>
       </div>
      </div>
     </section>
    </>
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
