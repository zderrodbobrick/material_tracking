import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { X } from 'lucide-react'
import { apiFetch } from '../api'
import {
 HorizontalBars,
 AreaChart,
 VerticalBars,
 MultiLineChart,
 GroupedBars,
} from '../components/charts'

const TABS = [
 { id: 'today', label: 'Today' },
 { id: 'orders', label: 'Orders' },
 { id: 'trends', label: 'Trends' },
 { id: 'drawings', label: 'Drawings' },
]

const RANGE_PRESETS = [
 { id: '7', label: 'Last 7 days', days: 7 },
 { id: '14', label: 'Last 14 days', days: 14 },
 { id: '30', label: 'Last 30 days', days: 30 },
 { id: 'custom', label: 'Custom', days: null },
]

const STATION_COLORS = ['#4dc4f4', '#34d399', '#fbbf24', '#f87171']

function targetLabel(status) {
 if (status === 'on_target') return { text: 'On target', cls: 'bb-badge-green' }
 if (status === 'slightly_over') return { text: 'Slightly over', cls: 'bb-badge-warn' }
 if (status === 'over_target') return { text: 'Over target', cls: 'bb-badge-danger' }
 return { text: '—', cls: 'bb-badge-muted' }
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

function formatWhen(iso) {
 if (!iso) return '—'
 try {
  return new Date(iso).toLocaleString('en-US', {
   month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
 } catch {
  return iso
 }
}

function shortDate(dateStr) {
 try {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
 } catch {
  return dateStr
 }
}

function ProgressBar({ pct, className = '' }) {
 const v = Math.max(0, Math.min(100, pct ?? 0))
 return (
  <div className={`h-1.5 rounded-full bg-[#27272f] overflow-hidden min-w-[4rem] ${className}`}>
   <div
    className={`h-full rounded-full transition-all duration-500 ${
     v >= 100 ? 'bg-[#34d399]' : 'bg-[#4dc4f4]'
    }`}
    style={{ width: `${v}%` }}
   />
  </div>
 )
}

function Kpi({ label, value, sub }) {
 return (
  <div>
   <p className="bb-kpi-label">{label}</p>
   <p className="bb-kpi-value">{value ?? '—'}</p>
   {sub && <p className="text-[11px] text-[#8b939e] mt-0.5">{sub}</p>}
  </div>
 )
}

function RangeControls({ rangeId, setRangeId, customFrom, customTo, setCustomFrom, setCustomTo }) {
 return (
  <div className="flex flex-wrap items-center gap-2">
   <div className="flex gap-0.5 p-0.5 rounded-[6px] bg-[#08080a] border border-[#2a2a32]">
    {RANGE_PRESETS.map(p => (
     <button
      key={p.id}
      type="button"
      onClick={() => setRangeId(p.id)}
      className={`px-2.5 py-1 rounded-[4px] text-xs font-medium transition-colors
       ${rangeId === p.id ? 'bg-[#4dc4f4] text-[#08080a]' : 'text-[#8b939e] hover:text-[#eef2f7]'}`}
     >
      {p.label}
     </button>
    ))}
   </div>
   {rangeId === 'custom' && (
    <div className="flex items-center gap-1.5">
     <input type="date" className="bb-input text-xs" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
     <span className="text-[#8b939e] text-xs">to</span>
     <input type="date" className="bb-input text-xs" value={customTo} onChange={e => setCustomTo(e.target.value)} />
    </div>
   )}
  </div>
 )
}

/* ── Today ──────────────────────────────────────────────────────────────────── */

function TodayTab({ a }) {
 const machines = (a.machines ?? []).filter(m => m.on_progress_spine)
 const orders = a.ibus_orders ?? []
 const attention = a.attention_items ?? []
 const spine = a.progress_spine ?? machines.map(m => m.station)

 const partsCompletedToday = machines.reduce((s, m) => s + (m.completed_today ?? 0), 0)
 const ordersComplete = orders.filter(o => (o.completion_pct ?? 0) >= 100).length
 const partsInProcess = a.parts_in_process ?? a.totals?.in_progress ?? 0
 const exceptionCount = a.exceptions?.attention_count
  ?? attention.filter(i => i.severity === 'warn' || i.severity === 'critical').length

 return (
  <div className="space-y-5">
   <div className="bb-kpi-strip">
    <Kpi label="Parts completed today" value={partsCompletedToday} sub="Station exits across the line" />
    <Kpi
     label="Orders completed"
     value={orders.length ? `${ordersComplete}/${orders.length}` : '—'}
     sub="Work orders at 100% RFID complete"
    />
    <Kpi label="Parts currently in process" value={partsInProcess} sub="Open station sessions right now" />
    <Kpi
     label="Exceptions requiring attention"
     value={exceptionCount}
     sub={exceptionCount ? 'See Attention Required below' : 'No open alerts'}
    />
   </div>

   <section className="bb-section">
    <div>
     <h2 className="bb-section-title">Production flow</h2>
     <p className="text-[11px] text-[#8b939e] mt-0.5">
      {(spine || []).join(' → ') || 'Tennoner → LBD → Gannomat → Insert Station'}
     </p>
    </div>
    {machines.length === 0 ? (
     <p className="bb-empty">No station data yet</p>
    ) : (
     <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {machines.map((m, i) => {
       const badge = targetLabel(m.vs_target_status)
       const ratio = m.target_part_dwell_seconds
        ? ((m.avg_dwell_seconds ?? 0) / m.target_part_dwell_seconds) * 100
        : null
       return (
        <div key={m.station_id ?? m.station} className="bb-card space-y-2">
         <div className="flex items-start justify-between gap-2">
          <div>
           <p className="text-[10px] uppercase tracking-wider text-[#8b939e]">Station {i + 1}</p>
           <p className="font-semibold text-[#eef2f7]">{m.station}</p>
          </div>
          <span className={badge.cls}>{badge.text}</span>
         </div>
         <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
           <p className="text-[10px] text-[#8b939e] uppercase">Completed</p>
           <p className="tabular-nums font-semibold">{m.completed_today ?? 0}</p>
          </div>
          <div>
           <p className="text-[10px] text-[#8b939e] uppercase">Present</p>
           <p className="tabular-nums font-semibold text-[#4dc4f4]">{m.in_process ?? 0}</p>
          </div>
          <div>
           <p className="text-[10px] text-[#8b939e] uppercase">Avg dwell</p>
           <p className="font-mono text-xs">{m.avg_dwell_display ?? '—'}</p>
          </div>
          <div>
           <p className="text-[10px] text-[#8b939e] uppercase">Target</p>
           <p className="font-mono text-xs text-[#8b939e]">{m.target_part_dwell_display ?? '—'}</p>
          </div>
         </div>
         {m.target_part_dwell_seconds != null && m.avg_dwell_seconds != null && (
          <div>
           <ProgressBar pct={Math.min(ratio, 100)} />
           <p className="text-[10px] text-[#8b939e] mt-1 tabular-nums">
            {(ratio ?? 0).toFixed(1)}% of target dwell
           </p>
          </div>
         )}
        </div>
       )
      })}
     </div>
    )}
   </section>

   <section className="bb-section">
    <h2 className="bb-section-title">Attention required</h2>
    {attention.length === 0 ? (
     <p className="text-sm text-[#8b939e] py-3 px-1">No exceptions requiring attention right now</p>
    ) : (
     <div className="grid gap-2 sm:grid-cols-2">
      {attention.slice(0, 12).map((item, i) => (
       <div
        key={i}
        className={`bb-card border-l-2 ${
         item.severity === 'critical' ? 'border-l-[#f87171]' : 'border-l-[#fbbf24]'
        }`}
       >
        <p className="text-sm font-medium text-[#eef2f7]">{item.title}</p>
        <p className="text-[11px] text-[#8b939e] mt-1">
         {[item.detail, item.ibus_number, item.station].filter(Boolean).join(' · ')}
        </p>
       </div>
      ))}
     </div>
    )}
   </section>
  </div>
 )
}

/* ── Orders ─────────────────────────────────────────────────────────────────── */

function OrderDetailDrawer({ ibus, onClose }) {
 const [detail, setDetail] = useState(null)
 const [error, setError] = useState(null)

 useEffect(() => {
  let alive = true
  setDetail(null)
  setError(null)
  apiFetch(`/api/analytics/orders/${encodeURIComponent(ibus)}`)
   .then(d => { if (alive) setDetail(d) })
   .catch(err => { if (alive) setError(err?.message || 'Failed to load order') })
  return () => { alive = false }
 }, [ibus])

 const order = detail?.order
 const spine = detail?.progress_spine ?? []

 return (
  <div className="bb-drawer-backdrop" onClick={onClose}>
   <aside className="bb-drawer max-w-xl" onClick={e => e.stopPropagation()}>
    <div className="bb-panel-header border-b border-[#2a2a32]">
     <div className="min-w-0">
      <h2 className="bb-title font-mono">{ibus}</h2>
      <p className="bb-subtitle truncate">
       {order?.customer || 'Order detail'}
       {order?.work_order ? ` · ${order.work_order}` : ''}
      </p>
     </div>
     <button type="button" onClick={onClose} className="bb-btn-ghost p-1.5" aria-label="Close">
      <X className="w-4 h-4" />
     </button>
    </div>

    <div className="p-4 space-y-4 overflow-y-auto flex-1">
     {error && <p className="text-sm text-[#fbbf24]">{error}</p>}
     {!detail && !error && <p className="bb-empty">Loading…</p>}
     {detail && (
      <>
       <div className="bb-kpi-strip">
        <Kpi label="Completed" value={order.rfid_completed} sub={`of ${order.expected_parts ?? '—'}`} />
        <Kpi label="In process" value={order.rfid_in_progress} />
        <Kpi label="Missing" value={order.missing_parts} />
        <Kpi label="Bottleneck" value={order.current_bottleneck || '—'} />
       </div>
       <div className="text-xs text-[#8b939e] space-y-1">
        <p>Started {formatWhen(order.start_time)} · Last activity {formatWhen(order.last_activity)}</p>
        <p>
         Est. completion{' '}
         {detail.estimated_completion_display
          ? `~${detail.estimated_completion_display} remaining`
          : '—'}
        </p>
       </div>

       <section>
        <h3 className="bb-section-title mb-2">Station progress</h3>
        <div className="bb-table-wrap">
         <table className="bb-table">
          <thead className="bb-table-head">
           <tr>
            <th>Station</th>
            <th className="text-right">Done</th>
            <th className="text-right">WIP</th>
            <th className="text-right">Avg</th>
            <th className="text-right">Longest</th>
           </tr>
          </thead>
          <tbody>
           {(order.station_progress || []).map(s => (
            <tr key={s.station} className="bb-table-row">
             <td>{s.station}</td>
             <td className="text-right tabular-nums">{s.completed}</td>
             <td className="text-right tabular-nums text-[#4dc4f4]">{s.in_process}</td>
             <td className="text-right font-mono text-xs">{s.avg_dwell_display ?? '—'}</td>
             <td className="text-right font-mono text-xs text-[#8b939e]">{s.max_dwell_display ?? '—'}</td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
       </section>

       {(detail.exceptions || []).length > 0 && (
        <section>
         <h3 className="bb-section-title mb-2">Exceptions</h3>
         <div className="space-y-1.5">
          {detail.exceptions.map((ex, i) => (
           <p key={i} className="text-sm text-[#fbbf24]">{ex.title}</p>
          ))}
         </div>
        </section>
       )}

       <section>
        <h3 className="bb-section-title mb-2">Parts</h3>
        <div className="bb-table-wrap max-h-80 overflow-y-auto">
         <table className="bb-table">
          <thead className="bb-table-head sticky top-0">
           <tr>
            <th>Part</th>
            <th>Drawing</th>
            <th>Status</th>
            <th>Location</th>
            {spine.map(st => (
             <th key={st} className="text-right">{st.split(' ')[0]}</th>
            ))}
           </tr>
          </thead>
          <tbody>
           {(detail.parts || []).map(p => (
            <tr key={p.epc} className="bb-table-row">
             <td className="font-mono text-[11px] truncate max-w-[7rem]">{p.part_name || p.epc}</td>
             <td className="text-xs text-[#8b939e]">{p.drawing || '—'}</td>
             <td>
              <span className={
               p.status === 'complete' ? 'bb-badge-green'
                : p.status === 'in_process' ? 'bb-badge-blue'
                 : 'bb-badge-muted'
              }>
               {p.status}
              </span>
             </td>
             <td className="text-xs">{p.current_station || '—'}</td>
             {spine.map(st => (
              <td key={st} className="text-right font-mono text-[11px] text-[#8b939e]">
               {p.stations?.[st]?.dwell_display ?? '—'}
              </td>
             ))}
            </tr>
           ))}
           {(detail.missing_components || []).map(c => (
            <tr key={c.epc || c.ref} className="bb-table-row opacity-70">
             <td className="font-mono text-[11px]">{c.ref || c.epc}</td>
             <td className="text-xs">{c.drawing || '—'}</td>
             <td><span className="bb-badge-warn">missing</span></td>
             <td className="text-xs text-[#8b939e]" colSpan={1 + spine.length}>Not tracked</td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
       </section>
      </>
     )}
    </div>
   </aside>
  </div>
 )
}

function OrdersTab({ a }) {
 const orders = a.ibus_orders ?? []
 const [selected, setSelected] = useState(null)
 const [expanded, setExpanded] = useState(null)

 if (!orders.length) {
  return <p className="bb-empty">No IBUS orders — ingest .R41 or run sim</p>
 }

 return (
  <div className="bb-section">
   <div>
    <h2 className="bb-section-title">All orders</h2>
    <p className="text-[11px] text-[#8b939e] mt-0.5">Click a row to expand; open detail for full part journey</p>
   </div>
   <div className="bb-table-wrap">
    <table className="bb-table">
     <thead className="bb-table-head">
      <tr>
       <th>IBUS</th>
       <th>Customer</th>
       <th className="text-right">Completed</th>
       <th className="text-right">In process</th>
       <th className="text-right">Missing</th>
       <th>Bottleneck</th>
       <th>Last activity</th>
       <th className="min-w-[8rem]">Progress</th>
       <th>Status</th>
      </tr>
     </thead>
     <tbody>
      {orders.map(o => {
       const pct = o.completion_pct ?? 0
       const open = expanded === o.ibus_number
       return (
        <Fragment key={o.ibus_number}>
         <tr
          className={`bb-table-row cursor-pointer ${open ? 'bb-table-row-active' : ''}`}
          onClick={() => setExpanded(open ? null : o.ibus_number)}
         >
          <td className="font-mono font-semibold text-[#eef2f7]">{o.ibus_number}</td>
          <td className="text-[#8b939e] truncate max-w-[10rem]">{o.customer || '—'}</td>
          <td className="text-right tabular-nums">{o.rfid_completed ?? 0}</td>
          <td className="text-right tabular-nums text-[#4dc4f4]">{o.rfid_in_progress ?? 0}</td>
          <td className="text-right tabular-nums text-[#fbbf24]">{o.missing_parts ?? 0}</td>
          <td className="text-xs">{o.current_bottleneck || '—'}</td>
          <td className="text-xs text-[#8b939e] whitespace-nowrap">{formatWhen(o.last_activity)}</td>
          <td>
           <div className="flex items-center gap-2">
            <ProgressBar pct={pct} className="flex-1" />
            <span className={`text-xs tabular-nums font-semibold ${pct >= 100 ? 'text-[#34d399]' : 'text-[#4dc4f4]'}`}>
             {pct}%
            </span>
           </div>
          </td>
          <td>
           <span className={
            pct >= 100 ? 'bb-badge-green'
             : (o.rfid_in_progress ?? 0) > 0 ? 'bb-badge-blue'
              : 'bb-badge-muted'
           }>
            {o.status_label || (pct >= 100 ? 'Complete' : 'Open')}
           </span>
          </td>
         </tr>
         {open && (
          <tr className="bb-table-row">
           <td colSpan={9} className="!bg-[#0c0c10]">
            <div className="py-2 space-y-2">
             <div className="flex flex-wrap gap-3 text-xs text-[#8b939e]">
              {(o.station_progress || []).map(s => (
               <span key={s.station}>
                <span className="text-[#eef2f7] font-medium">{s.station}</span>
                {' '}{s.completed} done · {s.in_process} WIP · avg {s.avg_dwell_display || '—'}
               </span>
              ))}
             </div>
             <button
              type="button"
              className="bb-btn-primary text-xs"
              onClick={e => { e.stopPropagation(); setSelected(o.ibus_number) }}
             >
              Open full order analysis
             </button>
            </div>
           </td>
          </tr>
         )}
        </Fragment>
       )
      })}
     </tbody>
    </table>
   </div>
   {selected && <OrderDetailDrawer ibus={selected} onClose={() => setSelected(null)} />}
  </div>
 )
}

/* ── Trends ─────────────────────────────────────────────────────────────────── */

function TrendsTab({ a, rangeId, setRangeId, customFrom, customTo, setCustomFrom, setCustomTo }) {
 const machines = (a.machines ?? []).filter(m => m.on_progress_spine !== false)

 const dayData = (a.throughput_by_day ?? []).map(d => ({
  label: d.date,
  short: shortDate(d.date),
  value: d.completed,
 }))

 const ordersDay = (a.orders_completed_by_day ?? []).map(d => ({
  label: d.date,
  short: shortDate(d.date),
  value: d.completed,
 }))

 const overTargetDay = (a.pct_over_target_by_day ?? []).map(d => ({
  label: d.date,
  short: shortDate(d.date),
  value: d.pct ?? 0,
 }))

 const exceptionSeries = [
  {
   id: 'over',
   label: 'Over target',
   color: '#fbbf24',
   points: (a.exceptions_by_day ?? []).map(d => ({
    label: d.date, short: shortDate(d.date), value: d.over_target ?? 0,
   })),
  },
  {
   id: 'exit',
   label: 'Exit-only / missing entry',
   color: '#f87171',
   points: (a.exceptions_by_day ?? []).map(d => ({
    label: d.date, short: shortDate(d.date), value: d.exit_only ?? 0,
   })),
  },
  {
   id: 'abandon',
   label: 'Abandoned',
   color: '#a78bfa',
   points: (a.exceptions_by_day ?? []).map(d => ({
    label: d.date, short: shortDate(d.date), value: d.abandoned ?? 0,
   })),
  },
 ]

 const dwellRatioData = machines
  .filter(m => m.avg_dwell_seconds != null)
  .map(m => ({
   label: m.station,
   value: m.avg_dwell_seconds,
   target: m.target_part_dwell_seconds,
   display: `${m.avg_dwell_display}${m.target_part_dwell_display ? ` / ${m.target_part_dwell_display}` : ''}`,
  }))

 const stationCompare = machines.map(m => ({
  label: m.station,
  short: (m.station || '').split(' ')[0],
  value: m.avg_dwell_seconds ?? 0,
  display: m.avg_dwell_display,
 }))

 const stationMedian = machines.map(m => ({
  label: m.station,
  value: m.median_dwell_seconds ?? 0,
 }))

 return (
  <div className="space-y-5">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
     <h2 className="bb-section-title">Trends</h2>
     <p className="text-[11px] text-[#8b939e] mt-0.5">Historical throughput, dwell, and exception patterns</p>
    </div>
    <RangeControls
     rangeId={rangeId}
     setRangeId={setRangeId}
     customFrom={customFrom}
     customTo={customTo}
     setCustomFrom={setCustomFrom}
     setCustomTo={setCustomTo}
    />
   </div>

   <div className="grid gap-4 lg:grid-cols-2">
    <section className="bb-section">
     <h2 className="bb-section-title">Daily throughput</h2>
     <div className="bb-panel px-4 py-4">
      {dayData.some(d => d.value > 0)
       ? <AreaChart data={dayData} primaryLabel="Completions" formatValue={v => `${v} parts`} />
       : <p className="bb-empty">No completions in this period</p>}
     </div>
     <p className="text-[11px] text-[#8b939e]">Closed RFID sessions per day across all stations.</p>
    </section>

    <section className="bb-section">
     <h2 className="bb-section-title">Orders completed per day</h2>
     <div className="bb-panel px-4 py-4">
      {ordersDay.some(d => d.value > 0)
       ? <AreaChart data={ordersDay} primaryLabel="Orders" formatValue={v => `${v} orders`} />
       : <p className="bb-empty">No order completions in this period</p>}
     </div>
    </section>

    <section className="bb-section">
     <h2 className="bb-section-title">Station comparison</h2>
     <div className="bb-panel px-4 py-4 space-y-4">
      <VerticalBars
       data={stationCompare}
       compareData={stationMedian}
       primaryLabel="Average dwell"
       compareLabel="Median dwell"
       formatValue={formatDwell}
      />
      <div className="bb-table-wrap">
       <table className="bb-table">
        <thead className="bb-table-head">
         <tr>
          <th>Station</th>
          <th className="text-right">Avg</th>
          <th className="text-right">Median</th>
          <th className="text-right">P90</th>
          <th className="text-right">Max</th>
         </tr>
        </thead>
        <tbody>
         {machines.map(m => (
          <tr key={m.station} className="bb-table-row">
           <td>{m.station}</td>
           <td className="text-right font-mono text-xs">{m.avg_dwell_display ?? '—'}</td>
           <td className="text-right font-mono text-xs">{m.median_dwell_display ?? '—'}</td>
           <td className="text-right font-mono text-xs">{m.p90_dwell_display ?? '—'}</td>
           <td className="text-right font-mono text-xs text-[#8b939e]">{m.max_dwell_display ?? '—'}</td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </div>
    </section>

    <section className="bb-section">
     <h2 className="bb-section-title">Dwell vs target</h2>
     <div className="bb-panel px-4 py-4">
      <HorizontalBars
       data={dwellRatioData}
       ratioMode
       emptyText="No completed sessions"
      />
     </div>
     <p className="text-[11px] text-[#8b939e]">
      Bar length = average dwell ÷ target. Short bars mean well under target.
     </p>
    </section>

    <section className="bb-section">
     <h2 className="bb-section-title">% parts exceeding target</h2>
     <div className="bb-panel px-4 py-4">
      {overTargetDay.some(d => d.value > 0)
       ? <AreaChart data={overTargetDay} primaryLabel="% over target" formatValue={v => `${v}%`} />
       : <p className="bb-empty">No over-target sessions in this period</p>}
     </div>
    </section>

    <section className="bb-section">
     <h2 className="bb-section-title">Exception trend</h2>
     <div className="bb-panel px-4 py-4">
      <MultiLineChart series={exceptionSeries} formatValue={v => `${v}`} emptyText="No exceptions" />
     </div>
     <p className="text-[11px] text-[#8b939e]">
      Overdue sessions, missing entry reads, and abandoned sessions by day.
     </p>
    </section>
   </div>
  </div>
 )
}

/* ── Drawings ───────────────────────────────────────────────────────────────── */

function DrawingDetailDrawer({ drawing, days, onClose }) {
 const [detail, setDetail] = useState(null)
 const [error, setError] = useState(null)

 useEffect(() => {
  let alive = true
  setDetail(null)
  const qs = days != null ? `?days=${days}` : ''
  apiFetch(`/api/analytics/drawings/${encodeURIComponent(drawing)}${qs}`)
   .then(d => { if (alive) setDetail(d) })
   .catch(err => { if (alive) setError(err?.message || 'Failed to load drawing') })
  return () => { alive = false }
 }, [drawing, days])

 const spine = detail?.progress_spine ?? []
 const summary = detail?.summary

 return (
  <div className="bb-drawer-backdrop" onClick={onClose}>
   <aside className="bb-drawer max-w-xl" onClick={e => e.stopPropagation()}>
    <div className="bb-panel-header border-b border-[#2a2a32]">
     <div className="min-w-0">
      <h2 className="bb-title font-mono">{drawing}</h2>
      <p className="bb-subtitle">Series {detail?.series || '—'} · part-level dwell</p>
     </div>
     <button type="button" onClick={onClose} className="bb-btn-ghost p-1.5" aria-label="Close">
      <X className="w-4 h-4" />
     </button>
    </div>
    <div className="p-4 space-y-4 overflow-y-auto flex-1">
     {error && <p className="text-sm text-[#fbbf24]">{error}</p>}
     {!detail && !error && <p className="bb-empty">Loading…</p>}
     {detail && (
      <>
       <div className="bb-kpi-strip">
        <Kpi label="Parts" value={summary?.parts_completed} sub={summary?.confidence ? `${summary.confidence} confidence` : undefined} />
        <Kpi label="Total avg" value={summary?.total_avg_display} />
        <Kpi label="Median" value={summary?.total_median_display} />
        <Kpi label="P90" value={summary?.total_p90_display} />
       </div>
       <div className="text-xs text-[#8b939e] space-y-1">
        <p>
         Fastest {summary?.total_min_display || '—'} · Slowest {summary?.total_max_display || '—'}
         {' · '}Range {summary?.total_range_display || '—'}
         {' · '}{summary?.parts_over_target ?? 0} sessions over target
         ({summary?.parts_over_target_pct ?? 0}%)
        </p>
        {summary?.slowest_station && summary?.station_contribution_pct?.[summary.slowest_station] != null && (
         <p className="text-[#4dc4f4]">
          {summary.slowest_station} accounts for ~{summary.station_contribution_pct[summary.slowest_station]}% of total tracked time
         </p>
        )}
        {summary?.pct_change_vs_prev != null && (
         <p>
          vs prior period: {summary.prev_total_avg_display || '—'} → {summary.total_avg_display || '—'}
          {' '}({summary.pct_change_vs_prev > 0 ? '+' : ''}{summary.pct_change_vs_prev}%)
         </p>
        )}
       </div>

       {(detail.trend || []).length > 0 && (
        <section>
         <h3 className="bb-section-title mb-2">Performance over time</h3>
         <div className="bb-panel px-3 py-3">
          <AreaChart
           data={detail.trend.map(t => ({
            label: t.date,
            short: shortDate(t.date),
            value: t.avg_total_seconds ?? 0,
           }))}
           primaryLabel="Avg total process time"
           formatValue={formatDwell}
          />
         </div>
        </section>
       )}

       <section>
        <h3 className="bb-section-title mb-2">Parts</h3>
        <div className="bb-table-wrap max-h-96 overflow-y-auto">
         <table className="bb-table">
          <thead className="bb-table-head sticky top-0">
           <tr>
            <th>Part / EPC</th>
            <th>IBUS</th>
            {spine.map(st => <th key={st} className="text-right">{st.split(' ')[0]}</th>)}
            <th className="text-right">Total</th>
            <th>Operator</th>
           </tr>
          </thead>
          <tbody>
           {(detail.parts || []).map(p => (
            <tr key={p.epc} className="bb-table-row">
             <td className="font-mono text-[11px] truncate max-w-[7rem]">{p.part_name || p.epc}</td>
             <td className="font-mono text-[11px] text-[#8b939e]">{p.ibus_number || '—'}</td>
             {spine.map(st => {
              const hit = Object.entries(p.stations || {}).find(([name]) =>
               name === st || name.startsWith(st.split(' ')[0]),
              )
              return (
               <td key={st} className="text-right font-mono text-[11px]">
                {hit?.[1]?.dwell_display ?? '—'}
               </td>
              )
             })}
             <td className="text-right font-mono text-xs font-semibold">{p.total_display}</td>
             <td className="text-[11px] text-[#8b939e] truncate max-w-[6rem]">
              {(p.operators || []).join(', ') || '—'}
             </td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
       </section>
      </>
     )}
    </div>
   </aside>
  </div>
 )
}

function MultiSelectDropdown({ label, options, selected, onChange, emptyText = 'None' }) {
 /** options: [{ value, label, sub? }]  selected: Set */
 const [open, setOpen] = useState(false)
 const allValues = options.map(o => o.value)
 const allSelected = options.length > 0 && allValues.every(v => selected.has(v))
 const count = options.filter(o => selected.has(o.value)).length

 const toggle = (value) => {
  const next = new Set(selected)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  onChange(next)
 }

 const selectAll = () => onChange(new Set(allValues))
 const clearAll = () => onChange(new Set())

 const summary = allSelected
  ? 'All'
  : count === 0
   ? 'None'
   : count === 1
    ? (options.find(o => selected.has(o.value))?.label ?? '1 selected')
    : `${count} selected`

 return (
  <div className="relative min-w-[12rem] flex-1">
   <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8b939e] mb-1">{label}</p>
   <button
    type="button"
    onClick={() => setOpen(v => !v)}
    className="bb-select w-full text-left flex items-center justify-between gap-2"
   >
    <span className="truncate text-sm">{summary}</span>
    <span className="text-[#8b939e] text-xs shrink-0">{open ? '▴' : '▾'}</span>
   </button>
   {open && (
    <>
     <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
     <div className="absolute z-40 mt-1 w-full min-w-[16rem] max-h-64 overflow-y-auto rounded-[6px]
                     bg-[#121218] border border-[#2a2a32] shadow-xl py-1">
      <div className="flex gap-1 px-2 py-1.5 border-b border-[#2a2a32] sticky top-0 bg-[#121218]">
       <button type="button" className="bb-btn-outline text-[10px]" onClick={selectAll}>Select all</button>
       <button type="button" className="bb-btn-outline text-[10px]" onClick={clearAll}>Clear</button>
      </div>
      {options.length === 0 ? (
       <p className="px-3 py-2 text-xs text-[#8b939e]">{emptyText}</p>
      ) : options.map(o => {
       const on = selected.has(o.value)
       return (
        <button
         key={o.value}
         type="button"
         onClick={() => toggle(o.value)}
         className={`w-full flex items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-[#1a1a22]
          ${on ? 'text-[#eef2f7]' : 'text-[#8b939e]'}`}
        >
         <span className={`mt-0.5 w-3.5 h-3.5 rounded-[3px] border shrink-0 flex items-center justify-center text-[10px]
          ${on ? 'bg-[#4dc4f4] border-[#4dc4f4] text-[#08080a]' : 'border-[#3a3a44]'}`}>
          {on ? '✓' : ''}
         </span>
         <span className="min-w-0">
          <span className="block truncate">{o.label}</span>
          {o.sub && <span className="block text-[10px] text-[#8b939e] truncate">{o.sub}</span>}
         </span>
        </button>
       )
      })}
     </div>
    </>
   )}
  </div>
 )
}

function shortDrawingLabel(drawing, max = 16) {
 if (!drawing) return '—'
 if (drawing.length <= max) return drawing
 return `${drawing.slice(0, max - 1)}…`
}

function DrawingsTab({ a, rangeId, setRangeId, customFrom, customTo, setCustomFrom, setCustomTo }) {
 const dp = a.drawing_performance ?? {}
 const drawings = dp.drawings ?? []
 const spine = dp.spine ?? a.progress_spine ?? []
 const [compareSeries, setCompareSeries] = useState(() => new Set())
 const [compareDrawings, setCompareDrawings] = useState(() => new Set())
 const [initialized, setInitialized] = useState(false)

 const availableSeries = useMemo(() => {
  const counts = new Map()
  for (const d of drawings) {
   const s = d.series || 'Unknown'
   counts.set(s, (counts.get(s) || 0) + (d.parts_completed || 0))
  }
  return [...counts.entries()]
   .sort((a, b) => a[0].localeCompare(b[0]))
   .map(([series, parts]) => ({ series, parts }))
 }, [drawings])

 const seriesOptions = useMemo(
  () => availableSeries.map(s => ({
   value: s.series,
   label: s.series,
   sub: `${s.parts} parts`,
  })),
  [availableSeries],
 )

 const drawingOptions = useMemo(() => {
  const seriesSet = compareSeries.size > 0
   ? compareSeries
   : new Set(availableSeries.map(s => s.series))
  return drawings
   .filter(d => seriesSet.has(d.series || 'Unknown'))
   .sort((a, b) => a.drawing.localeCompare(b.drawing))
   .map(d => ({
    value: d.drawing,
    label: d.drawing,
    sub: `Series ${d.series} · ${d.parts_completed} parts`,
   }))
 }, [drawings, compareSeries, availableSeries])

 useEffect(() => {
  if (initialized || drawings.length === 0) return
  setCompareSeries(new Set(availableSeries.map(s => s.series)))
  setCompareDrawings(new Set(drawings.map(d => d.drawing)))
  setInitialized(true)
 }, [availableSeries, drawings, initialized])

 const onSeriesChange = (nextSeries) => {
  setCompareSeries(nextSeries)
  const allowed = new Set(
   drawings
    .filter(d => nextSeries.size === 0 || nextSeries.has(d.series || 'Unknown'))
    .map(d => d.drawing),
  )
  setCompareDrawings(prev => new Set([...prev].filter(name => allowed.has(name))))
 }

 const selectedDrawingRows = useMemo(() => {
  if (compareSeries.size === 0) return []
  return drawings.filter(d =>
   compareSeries.has(d.series || 'Unknown') && compareDrawings.has(d.drawing),
  )
 }, [drawings, compareSeries, compareDrawings])

 // Aggregate selected drawings → series averages (for slowest-series KPI)
 const seriesStats = useMemo(() => {
  const bySeries = new Map()
  for (const d of selectedDrawingRows) {
   const s = d.series || 'Unknown'
   const acc = bySeries.get(s) || {
    series: s,
    parts: 0,
    totalSum: 0,
    totalW: 0,
   }
   const parts = d.parts_completed || 1
   acc.parts += d.parts_completed || 0
   if (d.total_avg_seconds != null) {
    acc.totalSum += d.total_avg_seconds * parts
    acc.totalW += parts
   }
   bySeries.set(s, acc)
  }
  return [...bySeries.values()].map(acc => {
   const totalAvg = acc.totalW > 0 ? acc.totalSum / acc.totalW : 0
   return {
    series: acc.series,
    parts: acc.parts,
    total_avg_seconds: totalAvg,
    total_avg_display: formatDwell(totalAvg),
   }
  }).sort((a, b) => (b.total_avg_seconds || 0) - (a.total_avg_seconds || 0))
 }, [selectedDrawingRows])

 const slowestSeries = seriesStats[0] || null

 const slowestStation = useMemo(() => {
  const totals = {}
  for (const st of spine) totals[st] = { sum: 0, n: 0 }
  for (const d of selectedDrawingRows) {
   for (const st of spine) {
    const v = d.stations?.[st]?.avg_seconds
    if (v != null && v > 0) {
     totals[st].sum += v
     totals[st].n += 1
    }
   }
  }
  let best = null
  let bestAvg = -1
  for (const st of spine) {
   if (!totals[st].n) continue
   const avg = totals[st].sum / totals[st].n
   if (avg > bestAvg) {
    bestAvg = avg
    best = st
   }
  }
  return best ? { station: best, avg_seconds: bestAvg, avg_display: formatDwell(bestAvg) } : null
 }, [selectedDrawingRows, spine])

 // Chart: one group per selected drawing
 const groups = useMemo(() => (
  [...selectedDrawingRows]
   .sort((a, b) => a.drawing.localeCompare(b.drawing))
   .map(d => ({
    label: d.drawing,
    series: d.series,
    drawing: d.drawing,
    short: shortDrawingLabel(d.drawing, 28),
    values: Object.fromEntries(
     spine.map(st => [st, d.stations?.[st]?.avg_seconds ?? 0]),
    ),
   }))
 ), [selectedDrawingRows, spine])

 return (
  <div className="space-y-5">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <h2 className="bb-section-title">Drawing performance</h2>
     <p className="text-[11px] text-[#8b939e] mt-0.5">
      Which series and station take the longest
     </p>
    </div>
    <RangeControls
     rangeId={rangeId}
     setRangeId={setRangeId}
     customFrom={customFrom}
     customTo={customTo}
     setCustomFrom={setCustomFrom}
     setCustomTo={setCustomTo}
    />
   </div>

   <div className="bb-kpi-strip">
    <Kpi
     label="Slowest series"
     value={slowestSeries ? slowestSeries.series : '—'}
     sub={slowestSeries
      ? `Avg total ${slowestSeries.total_avg_display} · ${slowestSeries.parts} parts`
      : 'No series data'}
    />
    <Kpi
     label="Slowest station"
     value={slowestStation?.station ?? '—'}
     sub={slowestStation
      ? `Avg ${slowestStation.avg_display} across selected drawings`
      : 'No station data'}
    />
   </div>

   <section className="bb-section">
    <div>
     <h2 className="bb-section-title">Average time by station</h2>
     <p className="text-[11px] text-[#8b939e] mt-0.5">
      Each group is a drawing · bar labels show average dwell at that station
     </p>
    </div>

    <div className="flex flex-wrap gap-3 items-start">
     <MultiSelectDropdown
      label="Series"
      options={seriesOptions}
      selected={compareSeries}
      onChange={onSeriesChange}
      emptyText="No series in this period"
     />
     <MultiSelectDropdown
      label="Drawing"
      options={drawingOptions}
      selected={compareDrawings}
      onChange={setCompareDrawings}
      emptyText={compareSeries.size === 0 ? 'Select a series first' : 'No drawings in selected series'}
     />
    </div>

    <div className="bb-panel px-4 py-4">
     <GroupedBars
      groups={groups}
      keys={spine}
      colors={STATION_COLORS}
      formatValue={formatDwell}
      showValues
      emptyText="Select series and drawings to compare"
     />
    </div>
   </section>
  </div>
 )
}

/* ── Page shell ─────────────────────────────────────────────────────────────── */

export function AnalyticsPage() {
 const [a, setA] = useState(null)
 const [loadError, setLoadError] = useState(null)
 const [tab, setTab] = useState('today')
 const [rangeId, setRangeId] = useState('14')
 const [customFrom, setCustomFrom] = useState('')
 const [customTo, setCustomTo] = useState('')

 const daysParam = useMemo(() => {
  if (tab === 'today') return 1
  if (tab === 'orders') return null
  if (rangeId === 'custom') {
   if (customFrom && customTo) return null
   return 14
  }
  const preset = RANGE_PRESETS.find(p => p.id === rangeId)
  return preset?.days ?? 14
 }, [tab, rangeId, customFrom, customTo])

 const load = useCallback(() => {
  const params = new URLSearchParams()
  if (daysParam != null) params.set('days', String(daysParam))
  if (tab !== 'today' && tab !== 'orders' && rangeId === 'custom' && customFrom && customTo) {
   params.set('date_from', customFrom)
   params.set('date_to', customTo)
  }
  const qs = params.toString() ? `?${params}` : ''
  apiFetch(`/api/analytics${qs}`)
   .then(res => {
    if (!Array.isArray(res.machines) || !Array.isArray(res.ibus_orders)) {
     setLoadError('Restart api.py to load the latest analytics endpoints.')
    } else {
     setLoadError(null)
    }
    setA(res)
   })
   .catch(err => {
    setLoadError(err?.message || 'Failed to load analytics')
    setA(null)
   })
 }, [daysParam, tab, rangeId, customFrom, customTo])

 useEffect(() => {
  load()
  const id = setInterval(load, 60000)
  return () => clearInterval(id)
 }, [load])

 const subtitle = {
  today: "Current production snapshot and attention items",
  orders: 'Work-order completion and part locations',
  trends: 'Historical performance and station trends',
  drawings: 'Slowest series, slowest station, and station times',
 }[tab]

 return (
  <div className="bobrick-shell space-y-4 min-h-[70vh]">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <h1 className="bb-page-title">Analytics</h1>
     <p className="bb-page-sub">{subtitle}</p>
    </div>
    <div className="flex gap-0.5 p-0.5 rounded-[6px] bg-[#08080a] border border-[#2a2a32]">
     {TABS.map(t => (
      <button
       key={t.id}
       type="button"
       onClick={() => setTab(t.id)}
       className={`px-3 py-1.5 rounded-[4px] text-sm font-medium transition-colors
        ${tab === t.id
         ? 'bg-[#4dc4f4] text-[#08080a]'
         : 'text-[#8b939e] hover:text-[#eef2f7]'}`}
      >
       {t.label}
      </button>
     ))}
    </div>
   </div>

   {loadError && (
    <div className="border border-[#fbbf24]/40 bg-[#fbbf24]/10 px-3 py-2 text-sm text-[#fbbf24] rounded-[6px]">
     {loadError}
    </div>
   )}

   {!a ? (
    <div className="bb-kpi-strip animate-pulse">
     {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-14" />
     ))}
    </div>
   ) : (
    <>
     {tab === 'today' && <TodayTab a={a} />}
     {tab === 'orders' && <OrdersTab a={a} />}
     {tab === 'trends' && (
      <TrendsTab
       a={a}
       rangeId={rangeId}
       setRangeId={setRangeId}
       customFrom={customFrom}
       customTo={customTo}
       setCustomFrom={setCustomFrom}
       setCustomTo={setCustomTo}
      />
     )}
     {tab === 'drawings' && (
      <DrawingsTab
       a={a}
       days={daysParam}
       rangeId={rangeId}
       setRangeId={setRangeId}
       customFrom={customFrom}
       customTo={customTo}
       setCustomFrom={setCustomFrom}
       setCustomTo={setCustomTo}
      />
     )}
    </>
   )}

   <p className="text-[11px] text-[#8b939e]">
    Operator activity is on the Operators tab · Session detail on Full Report
   </p>
  </div>
 )
}
