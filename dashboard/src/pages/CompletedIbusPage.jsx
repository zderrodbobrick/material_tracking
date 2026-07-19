import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { apiFetch } from '../api'
import { formatDwell } from '../components/DwellTimer'
import { ibusOrderKey, partTagLabel } from '../utils/ibusOrder'

function ibusLabel(j) {
 return j.ibus_order ?? j.ibus_number ?? ibusOrderKey(j) ?? j.key ?? '—'
}

function formatWhen(iso) {
 if (!iso) return '—'
 try {
  return new Date(iso).toLocaleString('en-US', {
   month: 'short',
   day: 'numeric',
   hour: 'numeric',
   minute: '2-digit',
   hour12: true,
  })
 } catch {
  return iso
 }
}

function formatDateInput(iso) {
 if (!iso) return ''
 try {
  return new Date(iso).toISOString().slice(0, 10)
 } catch {
  return ''
 }
}

function woNumber(j) {
 const label = ibusLabel(j)
 if (j.work_order) return String(j.work_order)
 if (label.startsWith('IBUS')) return label.slice(4)
 return label
}

function varianceClass(seconds) {
 if (seconds == null || seconds === 0) return 'text-[#34d399]'
 if (seconds > 0) return 'text-[#fbbf24]'
 return 'text-[#34d399]'
}

function onTimeStatus(j) {
 const sec = j.actual_vs_estimated_seconds
 if (sec == null) return 'unknown'
 if (sec <= 0) return 'on_time'
 return 'late'
}

function collectCustomers(journeys) {
 const set = new Set()
 for (const j of journeys) {
  if (j.customer) set.add(j.customer)
 }
 return [...set].sort()
}

function collectMachines(journeys) {
 const set = new Set()
 for (const j of journeys) {
  for (const m of j.machines ?? []) {
   if (m.station_name) set.add(m.station_name)
  }
  for (const p of j.parts ?? []) {
   for (const m of p.machines ?? []) {
    if (m.station_name) set.add(m.station_name)
   }
  }
 }
 return [...set].sort()
}

function collectOperators(journeys) {
 const set = new Set()
 for (const j of journeys) {
  for (const op of j.operators ?? []) {
   if (op.operator_name) set.add(op.operator_name)
  }
  for (const p of j.parts ?? []) {
   for (const op of p.operators ?? []) {
    if (op.operator_name) set.add(op.operator_name)
   }
  }
 }
 return [...set].sort()
}

/**
 * Completed IBUS: searchable order table → parts table → machine visits.
 */
export function CompletedIbusPage({ tick = 0 }) {
 const [journeys, setJourneys] = useState([])
 const [loading, setLoading] = useState(true)
 const [error, setError] = useState(null)
 const [search, setSearch] = useState('')
 const [dateFrom, setDateFrom] = useState('')
 const [dateTo, setDateTo] = useState('')
 const [customerFilter, setCustomerFilter] = useState('')
 const [timingFilter, setTimingFilter] = useState('all')
 const [machineFilter, setMachineFilter] = useState('')
 const [operatorFilter, setOperatorFilter] = useState('')
 const [selectedKey, setSelectedKey] = useState(null)
 const [selectedPartEpc, setSelectedPartEpc] = useState(null)

 const load = useCallback(async () => {
  try {
   const [rows, workOrders] = await Promise.all([
    apiFetch('/api/ibus?status=completed&limit=120'),
    apiFetch('/api/work-orders').catch(() => []),
   ])
   const customerByIbus = new Map()
   for (const wo of Array.isArray(workOrders) ? workOrders : []) {
    const key = String(wo.ibus_number || '').toUpperCase()
    if (key) customerByIbus.set(key, wo.customer || null)
   }
   const enriched = (Array.isArray(rows) ? rows : []).map(j => {
    const key = String(j.ibus_order || j.ibus_number || j.key || '').toUpperCase()
    return {
     ...j,
     customer: j.customer ?? customerByIbus.get(key) ?? null,
    }
   })
   setJourneys(enriched)
   setError(null)
  } catch (e) {
   setError(e?.message || 'Failed to load completed IBUS')
  } finally {
   setLoading(false)
  }
 }, [])

 useEffect(() => { load() }, [load, tick])

 const customers = useMemo(() => collectCustomers(journeys), [journeys])
 const machines = useMemo(() => collectMachines(journeys), [journeys])
 const operators = useMemo(() => collectOperators(journeys), [journeys])

 const filtered = useMemo(() => {
  return journeys.filter(j => {
   const label = ibusLabel(j)
   const wo = woNumber(j)
   const q = search.trim().toLowerCase()
   if (q) {
    const parts = (j.parts ?? []).map(p => `${p.part_tag} ${p.part_number} ${p.epc}`).join(' ')
    const hay = `${label} ${wo} ${j.customer ?? ''} ${parts}`.toLowerCase()
    if (!hay.includes(q)) return false
   }
   if (customerFilter && j.customer !== customerFilter) return false
   if (timingFilter !== 'all' && onTimeStatus(j) !== timingFilter) return false
   if (dateFrom || dateTo) {
    const completed = j.exit_time || j.entry_time
    const day = formatDateInput(completed)
    if (dateFrom && day && day < dateFrom) return false
    if (dateTo && day && day > dateTo) return false
   }
   if (machineFilter) {
    const names = new Set()
    for (const m of j.machines ?? []) if (m.station_name) names.add(m.station_name)
    for (const p of j.parts ?? []) {
     for (const m of p.machines ?? []) if (m.station_name) names.add(m.station_name)
    }
    if (!names.has(machineFilter)) return false
   }
   if (operatorFilter) {
    const names = new Set()
    for (const op of j.operators ?? []) if (op.operator_name) names.add(op.operator_name)
    for (const p of j.parts ?? []) {
     for (const op of p.operators ?? []) if (op.operator_name) names.add(op.operator_name)
    }
    if (!names.has(operatorFilter)) return false
   }
   return true
  })
 }, [journeys, search, customerFilter, timingFilter, dateFrom, dateTo, machineFilter, operatorFilter])

 const selectedOrder = useMemo(
  () => filtered.find(j => j.key === selectedKey) ?? journeys.find(j => j.key === selectedKey) ?? null,
  [filtered, journeys, selectedKey],
 )

 const selectedPart = useMemo(() => {
  if (!selectedOrder || selectedPartEpc == null) return null
  return (selectedOrder.parts ?? []).find(p => (p.epc || p.part_tag) === selectedPartEpc) ?? null
 }, [selectedOrder, selectedPartEpc])

 const openOrder = (key) => {
  setSelectedKey(key)
  setSelectedPartEpc(null)
 }

 const backToOrders = () => {
  setSelectedKey(null)
  setSelectedPartEpc(null)
 }

 const backToParts = () => {
  setSelectedPartEpc(null)
 }

 const clearFilters = () => {
  setSearch('')
  setDateFrom('')
  setDateTo('')
  setCustomerFilter('')
  setTimingFilter('all')
  setMachineFilter('')
  setOperatorFilter('')
 }

 const hasFilters = search || dateFrom || dateTo || customerFilter || timingFilter !== 'all' || machineFilter || operatorFilter

 return (
  <div className="space-y-3">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <h1 className="bb-page-title">Completed IBUS</h1>
     <p className="bb-page-sub">
      {selectedPart
       ? `${selectedPart.part_tag || selectedPart.part_number} — machine visits`
       : selectedOrder
        ? `${ibusLabel(selectedOrder)} — parts`
        : 'Completed work orders'}
     </p>
    </div>
    {(selectedOrder || selectedPart) && (
     <button
      type="button"
      onClick={selectedPart ? backToParts : backToOrders}
      className="bb-btn-outline"
     >
      <ArrowLeft className="w-3.5 h-3.5" />
      {selectedPart ? 'Parts' : 'Orders'}
     </button>
    )}
   </div>

   {error && <p className="text-sm text-[#f87171]">{error}</p>}

   {loading && !journeys.length ? (
    <p className="bb-empty">Loading…</p>
   ) : selectedPart ? (
    <PartMachineView part={selectedPart} orderLabel={ibusLabel(selectedOrder)} />
   ) : selectedOrder ? (
    <OrderPartsView
     order={selectedOrder}
     onSelectPart={(epc) => setSelectedPartEpc(epc)}
    />
   ) : (
    <>
     <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
       <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#8b939e] pointer-events-none" />
       <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Work order / IBUS…"
        className="bb-input pl-8 w-48"
       />
      </div>
      <input
       type="date"
       value={dateFrom}
       onChange={e => setDateFrom(e.target.value)}
       className="bb-input"
       title="Completed from"
      />
      <input
       type="date"
       value={dateTo}
       onChange={e => setDateTo(e.target.value)}
       className="bb-input"
       title="Completed to"
      />
      <select
       value={customerFilter}
       onChange={e => setCustomerFilter(e.target.value)}
       className="bb-select"
      >
       <option value="">All customers</option>
       {customers.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
       value={timingFilter}
       onChange={e => setTimingFilter(e.target.value)}
       className="bb-select"
      >
       <option value="all">On-time / late</option>
       <option value="on_time">On time</option>
       <option value="late">Late</option>
       <option value="unknown">No estimate</option>
      </select>
      <select
       value={machineFilter}
       onChange={e => setMachineFilter(e.target.value)}
       className="bb-select"
      >
       <option value="">All machines</option>
       {machines.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
       value={operatorFilter}
       onChange={e => setOperatorFilter(e.target.value)}
       className="bb-select"
      >
       <option value="">All operators</option>
       {operators.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {hasFilters && (
       <button type="button" onClick={clearFilters} className="bb-btn-ghost text-xs">
        Clear filters
       </button>
      )}
      <span className="ml-auto text-xs text-[#8b939e] tabular-nums">
       {filtered.length} orders
      </span>
     </div>

     {filtered.length === 0 ? (
      <p className="bb-empty">
       {journeys.length === 0 ? 'No completed IBUS orders yet' : 'No matches'}
      </p>
     ) : (
      <div className="bb-table-wrap">
       <table className="bb-table">
        <thead className="bb-table-head">
         <tr>
          <th>Work order</th>
          <th>IBUS</th>
          <th>Customer</th>
          <th className="text-right">Parts</th>
          <th className="text-right">Estimated</th>
          <th className="text-right">Actual</th>
          <th className="text-right">Variance</th>
          <th>Completed</th>
         </tr>
        </thead>
        <tbody>
         {filtered.map(j => {
          const timing = onTimeStatus(j)
          return (
           <tr
            key={j.key}
            className="bb-table-row cursor-pointer"
            onClick={() => openOrder(j.key)}
           >
            <td className="font-mono font-semibold text-[#eef2f7]">{woNumber(j)}</td>
            <td className="font-mono text-xs text-[#8b939e]">{ibusLabel(j)}</td>
            <td className="text-[#8b939e] truncate max-w-[10rem]">{j.customer || '—'}</td>
            <td className="text-right tabular-nums">{j.expected_parts ?? j.estimated_parts ?? j.part_count ?? j.parts?.length ?? 0}</td>
            <td className="text-right font-mono text-xs text-[#8b939e]">
             {j.estimated_total_display ?? '—'}
            </td>
            <td className="text-right font-mono text-xs">
             {j.total_production_display ?? formatDwell(j.total_production_seconds) ?? '—'}
            </td>
            <td className={`text-right font-mono text-xs tabular-nums ${varianceClass(j.actual_vs_estimated_seconds)}`}>
             {j.actual_vs_estimated_display ?? '—'}
             {timing === 'late' && <span className="ml-1.5 bb-badge-warn">Late</span>}
             {timing === 'on_time' && j.actual_vs_estimated_display && (
              <span className="ml-1.5 bb-badge-green">On time</span>
             )}
            </td>
            <td className="text-xs text-[#8b939e] whitespace-nowrap">
             {formatWhen(j.exit_time || j.entry_time)}
            </td>
           </tr>
          )
         })}
        </tbody>
       </table>
      </div>
     )}
    </>
   )}
  </div>
 )
}

function OrderPartsView({ order, onSelectPart }) {
 const parts = order.parts ?? []

 return (
  <div className="space-y-3">
   <div className="flex flex-wrap items-end justify-between gap-3 px-0.5">
    <div>
     <p className="font-mono text-base font-semibold text-[#eef2f7]">{ibusLabel(order)}</p>
     <p className="text-xs text-[#8b939e] mt-0.5">
      WO {woNumber(order)}
      {order.customer ? ` · ${order.customer}` : ''}
      {' · '}{formatWhen(order.entry_time)} → {formatWhen(order.exit_time)}
     </p>
    </div>
    <div className="text-right text-xs font-mono tabular-nums space-y-0.5">
     {order.estimated_total_display && (
      <p className="text-[#8b939e]">Est {order.estimated_total_display}</p>
     )}
     <p className="text-[#eef2f7]">
      Actual {order.total_production_display ?? formatDwell(order.total_production_seconds) ?? '—'}
     </p>
     {order.actual_vs_estimated_display && (
      <p className={varianceClass(order.actual_vs_estimated_seconds)}>
       {order.actual_vs_estimated_display}
      </p>
     )}
    </div>
   </div>

   <div className="bb-table-wrap">
    <table className="bb-table">
     <thead className="bb-table-head">
      <tr>
       <th>Part</th>
       <th>Drawing</th>
       <th className="text-right">Production time</th>
       <th>Start</th>
       <th>End</th>
       <th>Operators</th>
      </tr>
     </thead>
     <tbody>
      {parts.length === 0 ? (
       <tr>
        <td colSpan={6} className="bb-empty">No parts in this order</td>
       </tr>
      ) : (
       parts.map(p => {
        const key = p.epc || p.part_tag
        const ops = (p.operators ?? []).map(o => o.operator_name).filter(Boolean)
        return (
         <tr
          key={key}
          className="bb-table-row cursor-pointer"
          onClick={() => onSelectPart(key)}
         >
          <td>
           <p className="font-mono text-xs font-semibold text-[#eef2f7] break-all">
            {p.part_tag || partTagLabel(p) || p.ibus_number || '—'}
           </p>
           <p className="text-[11px] text-[#8b939e] mt-0.5">
            {[p.part_number, p.part_name].filter(Boolean).join(' · ') || '—'}
           </p>
          </td>
          <td className="text-xs text-[#eef2f7] max-w-[14rem]">
           {p.drawing || '—'}
          </td>
          <td className="text-right font-mono tabular-nums text-xs">
           {p.total_production_display ?? formatDwell(p.total_production_seconds) ?? '—'}
          </td>
          <td className="text-xs text-[#8b939e] whitespace-nowrap">{formatWhen(p.entry_time)}</td>
          <td className="text-xs text-[#8b939e] whitespace-nowrap">{formatWhen(p.exit_time)}</td>
          <td className="text-xs text-[#eef2f7]">{ops.length ? ops.join(', ') : '—'}</td>
         </tr>
        )
       })
      )}
     </tbody>
    </table>
   </div>
   <p className="text-[11px] text-[#8b939e]">Select a part row for machine visit detail</p>
  </div>
 )
}

function collectPartOperators(part) {
 const byId = new Map()
 for (const op of part?.operators ?? []) {
  const id = op.operator_id ?? op.operator_name
  if (id == null) continue
  byId.set(id, {
   operator_id: op.operator_id,
   operator_name: op.operator_name || '—',
   rtls_badge_id: op.rtls_badge_id,
   stations: [...(op.stations ?? [])],
  })
 }
 for (const m of part?.machines ?? []) {
  const st = m.station_name
  for (const op of [...(m.rtls ?? []), ...(m.operators ?? [])]) {
   const id = op.operator_id ?? op.operator_name
   if (id == null) continue
   const prev = byId.get(id)
   if (!prev) {
    byId.set(id, {
     operator_id: op.operator_id,
     operator_name: op.operator_name || '—',
     rtls_badge_id: op.rtls_badge_id,
     stations: st ? [st] : [],
    })
   } else if (st && !prev.stations.includes(st)) {
    prev.stations.push(st)
   }
  }
 }
 return [...byId.values()].sort((a, b) =>
  String(a.operator_name).localeCompare(String(b.operator_name)),
 )
}

function isTennonerStation(name) {
 const n = (name || '').toLowerCase()
 return n === 'tennoner' || n === 'tenoner'
}

/** Collapse every Tennoner visit into one row with a pass counter. */
function collapseTennonerMachines(machines, tenonerReturnCount = 0) {
 const list = machines ?? []
 const tenoner = list.filter(m => isTennonerStation(m.station_name))
 if (tenoner.length === 0) return list

 const rest = list.filter(m => !isTennonerStation(m.station_name))
 const firstIdx = list.findIndex(m => isTennonerStation(m.station_name))

 const entries = tenoner.map(m => m.entry_time).filter(Boolean).sort()
 const exits = tenoner.map(m => m.exit_time).filter(Boolean).sort()
 const dwellSum = tenoner.reduce((s, m) => s + (Number(m.dwell_seconds) || 0), 0)
 const opNames = new Set()
 for (const m of tenoner) {
  for (const op of [...(m.rtls ?? []), ...(m.operators ?? [])]) {
   if (op?.operator_name) opNames.add(op.operator_name)
  }
 }

 // Prefer return-trip counter; fall back to collapsed session count.
 const passes = tenonerReturnCount > 0 ? tenonerReturnCount : tenoner.length
 const summary = {
  session_id: `tenoner-summary-${tenoner[0]?.session_id ?? 'x'}`,
  station_name: 'Tennoner',
  tenoner_passes: passes,
  entry_time: entries[0] || tenoner[0]?.entry_time || null,
  exit_time: exits[exits.length - 1] || tenoner[tenoner.length - 1]?.exit_time || null,
  dwell_seconds: dwellSum || null,
  dwell_time_display: formatDwell(dwellSum) || tenoner[0]?.dwell_time_display || null,
  operators: [...opNames].map(name => ({ operator_name: name })),
  rtls: [...opNames].map(name => ({ operator_name: name })),
  _collapsed: true,
 }

 const out = [...rest]
 out.splice(Math.min(firstIdx, out.length), 0, summary)
 return out
}

function PartMachineView({ part, orderLabel }) {
 const machines = collapseTennonerMachines(
  part.machines ?? [],
  part.tenoner_return_count ?? 0,
 )
 const allOperators = collectPartOperators(part)

 return (
  <div className="space-y-3">
   <div className="px-0.5">
    <p className="font-mono text-base font-semibold text-[#eef2f7] break-all">
     {part.part_tag || part.ibus_number || '—'}
    </p>
    <p className="text-xs text-[#8b939e] mt-0.5">
     {orderLabel} · {part.part_number || '—'}
     {part.part_name ? ` · ${part.part_name}` : ''}
    </p>
    {part.drawing ? (
     <p className="text-xs text-[#eef2f7] mt-1">
      <span className="text-[#8b939e]">Drawing · </span>{part.drawing}
     </p>
    ) : null}
   </div>

   {allOperators.length > 0 && (
    <p className="text-xs text-[#8b939e] px-0.5">
     Operators:{' '}
     <span className="text-[#eef2f7]">
      {allOperators.map(op =>
       op.stations.length
        ? `${op.operator_name} (${op.stations.join(', ')})`
        : op.operator_name,
      ).join(' · ')}
     </span>
    </p>
   )}

   {machines.length === 0 ? (
    <p className="bb-empty">No machine sessions for this part</p>
   ) : (
    <div className="bb-table-wrap">
     <table className="bb-table">
      <thead className="bb-table-head">
       <tr>
        <th>Station</th>
        <th className="text-right">Passes</th>
        <th>Entered</th>
        <th>Exited</th>
        <th className="text-right">Dwell</th>
        <th>Operators</th>
       </tr>
      </thead>
      <tbody>
       {machines.map(m => {
        const rtls = m.rtls ?? m.operators ?? []
        const passes = isTennonerStation(m.station_name)
         ? (m.tenoner_passes ?? part.tenoner_return_count ?? 1)
         : null
        return (
         <tr key={m.session_id ?? `${m.station_name}-${m.entry_time}`} className="bb-table-row">
          <td className="font-medium text-[#eef2f7]">{m.station_name || '—'}</td>
          <td className="text-right font-mono text-xs tabular-nums text-[#4dc4f4]">
           {passes != null ? passes : '—'}
          </td>
          <td className="text-xs text-[#8b939e] whitespace-nowrap">{formatWhen(m.entry_time)}</td>
          <td className="text-xs text-[#8b939e] whitespace-nowrap">{formatWhen(m.exit_time)}</td>
          <td className="text-right font-mono text-xs tabular-nums">
           {m.dwell_time_display ?? formatDwell(m.dwell_seconds) ?? '—'}
          </td>
          <td className="text-xs text-[#8b939e]">
           {rtls.length
            ? rtls.map(op => op.operator_name).filter(Boolean).join(', ') || '—'
            : '—'}
          </td>
         </tr>
        )
       })}
      </tbody>
     </table>
    </div>
   )}
  </div>
 )
}
