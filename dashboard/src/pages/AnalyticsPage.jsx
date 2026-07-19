import { useState, useEffect, useCallback, useMemo } from 'react'
import { apiFetch } from '../api'
import { HorizontalBars, AreaChart } from '../components/charts'

const TABS = [
 { id: 'today', label: 'Today' },
 { id: 'orders', label: 'Orders' },
 { id: 'trends', label: 'Trends' },
]

function targetLabel(status) {
 if (status === 'on_target') return { text: 'On target', cls: 'bb-badge-green' }
 if (status === 'slightly_over') return { text: 'Slightly over', cls: 'bb-badge-warn' }
 if (status === 'over_target') return { text: 'Over target', cls: 'bb-badge-danger' }
 return { text: '—', cls: 'bb-badge-muted' }
}

function formatVariance(avgSec, targetSec) {
 if (avgSec == null || targetSec == null) return '—'
 const diff = Math.round(avgSec - targetSec)
 const abs = Math.abs(diff)
 const m = Math.floor(abs / 60)
 const s = abs % 60
 const body = m > 0 ? `${m}m ${s}s` : `${s}s`
 if (diff === 0) return '0s'
 return diff < 0 ? `−${body}` : `+${body}`
}

function parseTargetSeconds(display) {
 if (!display || typeof display !== 'string') return null
 const m = display.match(/(\d+)\s*m/)
 const s = display.match(/(\d+)\s*s/)
 const mins = m ? parseInt(m[1], 10) : 0
 const secs = s ? parseInt(s[1], 10) : 0
 if (!m && !s) return null
 return mins * 60 + secs
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

function TodayTab({ a }) {
 const machines = (a.machines ?? []).filter(m => m.on_progress_spine)
 const orders = a.ibus_orders ?? []
 const ex = a.exceptions ?? {}
 const bottleneck = a.bottleneck

 const stationCompletions = machines.reduce((s, m) => s + (m.completed_today ?? 0), 0)
 const ordersBehind = orders.filter(o => (o.completion_pct ?? 0) < 100 && (o.rfid_in_progress ?? 0) > 0).length
 const ordersComplete = orders.filter(o => (o.completion_pct ?? 0) >= 100).length
 const exceptionCount = (ex.exceeding_target ?? 0) + (ex.exit_only ?? 0) + (ex.abandoned ?? 0)

 return (
  <div className="space-y-5">
   <div className="bb-kpi-strip">
    <Kpi
     label="Station completions"
     value={stationCompletions}
     sub="RFID exits across stations today"
    />
    <Kpi
     label="Orders completed"
     value={orders.length ? `${ordersComplete}/${orders.length}` : '—'}
     sub="Work orders at 100% RFID complete"
    />
    <Kpi
     label="Slowest station"
     value={bottleneck?.station ?? '—'}
     sub={bottleneck ? `Avg dwell ${bottleneck.avg_dwell_display}` : 'No dwell data yet'}
    />
    <Kpi
     label="Orders behind target"
     value={ordersBehind || 0}
     sub={exceptionCount ? `${exceptionCount} session exceptions` : 'No open orders lagging'}
    />
   </div>

   <section className="bb-section">
    <h2 className="bb-section-title">Order progress</h2>
    {orders.length === 0 ? (
     <p className="bb-empty">No IBUS orders — ingest .R41 or run sim</p>
    ) : (
     <div className="bb-table-wrap">
      <table className="bb-table">
       <thead className="bb-table-head">
        <tr>
         <th>IBUS</th>
         <th>Customer</th>
         <th className="text-right">RFID complete</th>
         <th className="text-right">Expected</th>
         <th className="text-right">In progress</th>
         <th className="text-right">%</th>
        </tr>
       </thead>
       <tbody>
        {orders.map(o => {
         const pct = o.completion_pct ?? 0
         const done = pct >= 100
         return (
          <tr key={o.ibus_number} className="bb-table-row">
           <td className="font-mono font-semibold text-[#eef2f7]">{o.ibus_number}</td>
           <td className="text-[#8b939e] truncate max-w-[12rem]">{o.customer || '—'}</td>
           <td className="text-right tabular-nums">{o.rfid_completed ?? 0}</td>
           <td className="text-right tabular-nums text-[#8b939e]">{o.expected_parts ?? '—'}</td>
           <td className="text-right tabular-nums text-[#8b939e]">{o.rfid_in_progress ?? 0}</td>
           <td className="text-right">
            <span className={`tabular-nums font-semibold ${done ? 'text-[#34d399]' : 'text-[#4dc4f4]'}`}>
             {pct}%
            </span>
           </td>
          </tr>
         )
        })}
       </tbody>
      </table>
     </div>
    )}
    <p className="text-[11px] text-[#8b939e]">
     RFID complete = unique parts with a closed session at Insert Station. Expected = BOM / work-order part count.
    </p>
   </section>

   <section className="bb-section">
    <h2 className="bb-section-title">Station performance</h2>
    {machines.length === 0 ? (
     <p className="bb-empty">No station data yet</p>
    ) : (
     <div className="bb-table-wrap">
      <table className="bb-table">
       <thead className="bb-table-head">
        <tr>
         <th>Station</th>
         <th className="text-right">Parts</th>
         <th className="text-right">Avg dwell</th>
         <th className="text-right">Target</th>
         <th className="text-right">Variance</th>
         <th>Status</th>
        </tr>
       </thead>
       <tbody>
        {machines.map(m => {
         const badge = targetLabel(m.vs_target_status)
         const targetSec = m.target_part_dwell_seconds ?? parseTargetSeconds(m.target_part_dwell_display)
         return (
          <tr key={m.station_id ?? m.station} className="bb-table-row">
           <td className="font-medium text-[#eef2f7]">{m.station}</td>
           <td className="text-right tabular-nums">{m.completed_today ?? 0}</td>
           <td className="text-right font-mono text-xs">{m.avg_dwell_display ?? '—'}</td>
           <td className="text-right font-mono text-xs text-[#8b939e]">
            {m.target_part_dwell_display ?? '—'}
           </td>
           <td className="text-right font-mono text-xs tabular-nums">
            {formatVariance(m.avg_dwell_seconds, targetSec)}
           </td>
           <td>
            <span className={badge.cls}>{badge.text}</span>
            {(m.in_process ?? 0) > 0 && (
             <span className="ml-2 text-[11px] text-[#4dc4f4]">{m.in_process} in process</span>
            )}
           </td>
          </tr>
         )
        })}
       </tbody>
      </table>
     </div>
    )}
    <p className="text-[11px] text-[#8b939e]">
     Parts = RFID station completions today (a part counted once per station exit).
    </p>
   </section>

   <section className="bb-section">
    <h2 className="bb-section-title">Exceptions</h2>
    {exceptionCount === 0 ? (
     <p className="text-sm text-[#8b939e] py-3 px-1">
      No stations currently exceeding target dwell time
     </p>
    ) : (
     <div className="bb-table-wrap">
      <table className="bb-table">
       <thead className="bb-table-head">
        <tr>
         <th>Type</th>
         <th className="text-right">Count</th>
        </tr>
       </thead>
       <tbody>
        {(ex.exceeding_target ?? 0) > 0 && (
         <tr className="bb-table-row">
          <td>Sessions over dwell target</td>
          <td className="text-right tabular-nums text-[#fbbf24]">{ex.exceeding_target}</td>
         </tr>
        )}
        {(ex.exit_only ?? 0) > 0 && (
         <tr className="bb-table-row">
          <td>Exit-only (missing entry read)</td>
          <td className="text-right tabular-nums text-[#fbbf24]">{ex.exit_only}</td>
         </tr>
        )}
        {(ex.abandoned ?? 0) > 0 && (
         <tr className="bb-table-row">
          <td>Abandoned sessions</td>
          <td className="text-right tabular-nums text-[#f87171]">{ex.abandoned}</td>
         </tr>
        )}
       </tbody>
      </table>
     </div>
    )}
   </section>
  </div>
 )
}

function OrdersTab({ a }) {
 const orders = a.ibus_orders ?? []
 if (!orders.length) {
  return <p className="bb-empty">No IBUS orders — ingest .R41 or run sim</p>
 }
 return (
  <div className="bb-section">
   <h2 className="bb-section-title">All orders</h2>
   <div className="bb-table-wrap">
    <table className="bb-table">
     <thead className="bb-table-head">
      <tr>
       <th>IBUS</th>
       <th>Work order</th>
       <th>Customer</th>
       <th>Status</th>
       <th className="text-right">RFID complete</th>
       <th className="text-right">Expected</th>
       <th className="text-right">%</th>
      </tr>
     </thead>
     <tbody>
      {orders.map(o => {
       const pct = o.completion_pct ?? 0
       return (
        <tr key={o.ibus_number} className="bb-table-row">
         <td className="font-mono font-semibold">{o.ibus_number}</td>
         <td className="font-mono text-xs text-[#8b939e]">{o.work_order || '—'}</td>
         <td className="text-[#8b939e] truncate max-w-[12rem]">{o.customer || '—'}</td>
         <td>
          <span className={pct >= 100 ? 'bb-badge-green' : (o.rfid_in_progress ?? 0) > 0 ? 'bb-badge-blue' : 'bb-badge-muted'}>
           {pct >= 100 ? 'Complete' : (o.rfid_in_progress ?? 0) > 0 ? 'In process' : o.status || 'Open'}
          </span>
         </td>
         <td className="text-right tabular-nums">{o.rfid_completed ?? 0}</td>
         <td className="text-right tabular-nums text-[#8b939e]">{o.expected_parts ?? '—'}</td>
         <td className={`text-right tabular-nums font-semibold ${pct >= 100 ? 'text-[#34d399]' : 'text-[#4dc4f4]'}`}>
          {pct}%
         </td>
        </tr>
       )
      })}
     </tbody>
    </table>
   </div>
  </div>
 )
}

function TrendsTab({ a }) {
 const machines = (a.machines ?? []).filter(m => m.on_progress_spine !== false && m.avg_dwell_seconds != null)
 const dwellData = machines.map(m => ({
  label: m.station,
  value: m.avg_dwell_seconds,
  display: `${m.avg_dwell_display}${m.target_part_dwell_display ? ` / ${m.target_part_dwell_display}` : ''}`,
 }))

 const dayData = (a.throughput_by_day ?? []).map(d => ({
  label: d.date,
  short: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  value: d.completed,
 }))

 return (
  <div className="space-y-5">
   <section className="bb-section">
    <h2 className="bb-section-title">Throughput — last 14 days</h2>
    <div className="bb-panel px-4 py-4">
     {dayData.some(d => d.value > 0)
      ? <AreaChart data={dayData} formatValue={v => `${v} parts`} />
      : <p className="bb-empty">No completions in this period</p>}
    </div>
    <p className="text-[11px] text-[#8b939e]">Daily count of RFID station completions (closed sessions).</p>
   </section>

   <section className="bb-section">
    <h2 className="bb-section-title">Dwell vs target by station</h2>
    <div className="bb-panel px-4 py-4">
     <HorizontalBars data={dwellData} accent="bobrick" emptyText="No completed sessions" />
    </div>
   </section>
  </div>
 )
}

export function AnalyticsPage() {
 const [a, setA] = useState(null)
 const [loadError, setLoadError] = useState(null)
 const [tab, setTab] = useState('today')

 const daysParam = useMemo(() => {
  if (tab === 'today') return 1
  if (tab === 'trends') return 14
  return null
 }, [tab])

 const load = useCallback(() => {
  const qs = daysParam != null ? `?days=${daysParam}` : ''
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
 }, [daysParam])

 useEffect(() => {
  load()
  const id = setInterval(load, 60000)
  return () => clearInterval(id)
 }, [load])

 return (
  <div className="bobrick-shell space-y-4 min-h-[70vh]">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <h1 className="bb-page-title">Analytics</h1>
     <p className="bb-page-sub">Today&apos;s production and station performance</p>
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
     {tab === 'trends' && <TrendsTab a={a} />}
    </>
   )}

   <p className="text-[11px] text-[#8b939e]">
    Operator activity is on the Operators tab · Session detail on Full Report
   </p>
  </div>
 )
}
