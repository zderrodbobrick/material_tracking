import { useState, useEffect, useCallback, useMemo } from 'react'
import {
 Factory, CalendarDays, Package, AlertTriangle,
 Target, Gauge, ChevronRight,
} from 'lucide-react'
import { apiFetch } from '../api'
import { HorizontalBars, AreaChart } from '../components/charts'

const TABS = [
 { id: 'today', label: 'Today' },
 { id: 'orders', label: 'Orders' },
 { id: 'trends', label: 'Trends' },
]

function targetLabel(status) {
 if (status === 'on_target') return { text: 'On target', cls: 'text-[#34d399] bg-[#34d399]/10 border-[#34d399]/25' }
 if (status === 'slightly_over') return { text: 'Slightly over', cls: 'text-[#fbbf24] bg-[#fbbf24]/10 border-[#fbbf24]/25' }
 if (status === 'over_target') return { text: 'Over target', cls: 'text-[#f87171] bg-[#f87171]/10 border-[#f87171]/25' }
 return { text: '—', cls: 'text-[#8b939e] bg-[#18181d]/5 border-[#27272f]' }
}

function PulseKpi({ label, value, sub }) {
 return (
  <div className="rounded-xl border border-[#27272f] bg-[#18181d] p-4">
   <p className="text-[10px] font-semibold uppercase tracking-widest text-[#8b939e]">{label}</p>
   <p className="text-2xl font-bold text-[#eef2f7] mt-1 tabular-nums">{value ?? '—'}</p>
   {sub && <p className="text-xs text-[#8b939e] mt-1">{sub}</p>}
  </div>
 )
}

function MachineTile({ m }) {
 const badge = targetLabel(m.vs_target_status)
 return (
  <div className="rounded-xl border border-[#27272f] bg-[#18181d] p-4 space-y-3">
   <div className="flex items-start justify-between gap-2">
    <div>
     <h3 className="font-bold text-[#eef2f7]">{m.station}</h3>
     <p className="text-xs text-[#8b939e]">{m.completed_today ?? 0} done today</p>
    </div>
    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${badge.cls}`}>
     {badge.text}
    </span>
   </div>
   <div className="flex items-baseline justify-between text-sm">
    <span className="text-[#8b939e]">Avg dwell</span>
    <span className="font-mono font-semibold text-[#4dc4f4]">
     {m.avg_dwell_display ?? '—'}
     {m.target_part_dwell_display && (
      <span className="text-[#8b939e] font-normal text-xs ml-1">/ {m.target_part_dwell_display}</span>
     )}
    </span>
   </div>
   {(m.in_process ?? 0) > 0 && (
    <p className="text-xs text-[#4dc4f4]">{m.in_process} in process now</p>
   )}
   {(m.exceeding_target ?? 0) > 0 && (
    <p className="text-xs text-[#fbbf24]">{m.exceeding_target} over target</p>
   )}
  </div>
 )
}

function OrderRow({ o }) {
 const pct = o.completion_pct ?? 0
 const done = pct >= 100
 return (
  <div className="rounded-xl border border-[#27272f] bg-[#18181d] p-4">
   <div className="flex items-center justify-between gap-3 mb-2">
    <div>
     <p className="font-mono font-bold text-[#eef2f7]">{o.ibus_number}</p>
     {o.customer && <p className="text-xs text-[#8b939e] truncate">{o.customer}</p>}
    </div>
    <p className={`text-lg font-bold tabular-nums ${done ? 'text-[#34d399]' : 'text-[#4dc4f4]'}`}>
     {pct}%
    </p>
   </div>
   <div className="h-1.5 rounded-full bg-[#27272f] overflow-hidden">
    <div
     className={`h-full rounded-full transition-all ${done ? 'bg-[#34d399]' : 'bg-[#4dc4f4]'}`}
     style={{ width: `${Math.min(pct, 100)}%` }}
    />
   </div>
   <p className="text-xs text-[#8b939e] mt-2 tabular-nums">
    {o.rfid_completed ?? 0} / {o.expected_parts ?? '—'} parts RFID complete
    {(o.rfid_in_progress ?? 0) > 0 && ` · ${o.rfid_in_progress} in progress`}
   </p>
  </div>
 )
}

function TodayTab({ a }) {
 const machines = (a.machines ?? []).filter(m => m.on_progress_spine !== false)
 const orders = a.ibus_orders ?? []
 const ex = a.exceptions ?? {}
 const bottleneck = a.bottleneck

 const completedToday = machines.reduce((s, m) => s + (m.completed_today ?? 0), 0)
 const ordersOnTrack = orders.filter(o => (o.completion_pct ?? 0) >= 100 || (o.rfid_in_progress ?? 0) === 0).length
 const needsAttention = (ex.exceeding_target ?? 0) + (ex.exit_only ?? 0) + (ex.abandoned ?? 0)

 const headline = orders.length === 1
  ? `${orders[0].ibus_number} — ${orders[0].rfid_completed ?? 0}/${orders[0].expected_parts ?? '?'} complete`
  : orders.length > 1
   ? `${orders.filter(o => (o.completion_pct ?? 0) >= 100).length} of ${orders.length} orders complete`
   : 'No active orders'

 return (
  <div className="space-y-6">
   <div className="rounded-xl border border-[#4dc4f4]/20 bg-[#4dc4f4]/5 px-5 py-4">
    <p className="text-xs font-semibold uppercase tracking-widest text-[#4dc4f4]">Today&apos;s pulse</p>
    <p className="text-lg font-medium text-[#eef2f7] mt-1">{headline}</p>
   </div>

   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    <PulseKpi label="Completed today" value={completedToday} sub="Across all stations" />
    <PulseKpi
     label="Orders on track"
     value={orders.length ? `${ordersOnTrack}/${orders.length}` : '—'}
    />
    <PulseKpi
     label="Slowest machine"
     value={bottleneck?.station ?? '—'}
     sub={bottleneck ? `Avg ${bottleneck.avg_dwell_display}` : undefined}
    />
    <PulseKpi
     label="Needs attention"
     value={needsAttention || 'None'}
     sub={needsAttention ? 'Over target or exceptions' : 'All clear'}
    />
   </div>

   {orders.length > 0 && (
    <section>
     <h2 className="text-sm font-semibold text-[#8b939e] uppercase tracking-wider mb-3 flex items-center gap-2">
      <Package className="w-4 h-4 text-[#4dc4f4]" />
      Orders
     </h2>
     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {orders.slice(0, 4).map(o => <OrderRow key={o.ibus_number} o={o} />)}
     </div>
    </section>
   )}

   <section>
    <h2 className="text-sm font-semibold text-[#8b939e] uppercase tracking-wider mb-3 flex items-center gap-2">
     <Factory className="w-4 h-4 text-[#4dc4f4]" />
     Machines — actual vs target
    </h2>
    {machines.length === 0 ? (
     <p className="text-sm text-[#8b939e] py-8 text-center">No machine data yet</p>
    ) : (
     <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {machines.map(m => <MachineTile key={m.station_id ?? m.station} m={m} />)}
     </div>
    )}
   </section>

   {needsAttention > 0 && (
    <div className="rounded-xl border border-[#fbbf24]/30 bg-[#fbbf24]/5 px-4 py-3 flex items-start gap-3 text-sm text-[#fbbf24]">
     <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
     <div>
      {(ex.exceeding_target ?? 0) > 0 && <p>{ex.exceeding_target} sessions over dwell target</p>}
      {(ex.exit_only ?? 0) > 0 && <p>{ex.exit_only} exit-only (missing entry read)</p>}
      {(ex.abandoned ?? 0) > 0 && <p>{ex.abandoned} abandoned sessions</p>}
     </div>
    </div>
   )}
  </div>
 )
}

function OrdersTab({ a }) {
 const orders = a.ibus_orders ?? []
 if (!orders.length) {
  return <p className="text-sm text-[#8b939e] py-12 text-center">No IBUS orders — ingest .R41 or run sim</p>
 }
 return (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
   {orders.map(o => <OrderRow key={o.ibus_number} o={o} />)}
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
  <div className="space-y-6">
   <div className="rounded-xl border border-[#27272f] bg-[#18181d] overflow-hidden">
    <div className="px-5 py-4 border-b border-[#27272f] flex items-center gap-2">
     <CalendarDays className="w-4 h-4 text-[#4dc4f4]" />
     <h2 className="font-semibold text-[#eef2f7]">Throughput — last 14 days</h2>
    </div>
    <div className="px-5 py-5">
     {dayData.some(d => d.value > 0)
      ? <AreaChart data={dayData} formatValue={v => `${v} parts`} />
      : <p className="text-sm text-[#8b939e] py-8 text-center">No completions in this period</p>}
    </div>
   </div>

   <div className="rounded-xl border border-[#27272f] bg-[#18181d] overflow-hidden">
    <div className="px-5 py-4 border-b border-[#27272f] flex items-center gap-2">
     <Target className="w-4 h-4 text-[#4dc4f4]" />
     <h2 className="font-semibold text-[#eef2f7]">Dwell vs target by machine</h2>
    </div>
    <div className="px-5 py-5">
     <HorizontalBars data={dwellData} accent="bobrick" emptyText="No completed sessions" />
    </div>
   </div>
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
  <div className="bobrick-shell rounded-2xl border border-[#27272f] bg-[#111114] p-4 sm:p-6 min-h-[70vh]">
   <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
    <div>
     <h1 className="text-xl font-bold text-[#eef2f7] flex items-center gap-2">
      <Gauge className="w-5 h-5 text-[#4dc4f4]" />
      Analytics
     </h1>
     <p className="text-sm text-[#8b939e] mt-0.5">Production efficiency at a glance</p>
    </div>
    <div className="flex gap-1 p-1 rounded-lg bg-[#08080a] border border-[#27272f]">
     {TABS.map(t => (
      <button
       key={t.id}
       type="button"
       onClick={() => setTab(t.id)}
       className={`px-4 py-2 rounded-md text-sm font-medium transition-colors
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
    <div className="mb-4 rounded-lg border border-[#fbbf24]/40 bg-[#fbbf24]/10 px-4 py-3 text-sm text-[#fbbf24]">
     {loadError}
    </div>
   )}

   {!a ? (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
     {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-24 rounded-xl bg-[#18181d] border border-[#27272f] animate-pulse" />
     ))}
    </div>
   ) : (
    <>
     {tab === 'today' && <TodayTab a={a} />}
     {tab === 'orders' && <OrdersTab a={a} />}
     {tab === 'trends' && <TrendsTab a={a} />}
    </>
   )}

   <p className="mt-8 text-[10px] text-[#8b939e] flex items-center gap-1">
    <ChevronRight className="w-3 h-3" />
    Operator detail lives on the Operators tab · Session detail on Full Report
   </p>
  </div>
 )
}
