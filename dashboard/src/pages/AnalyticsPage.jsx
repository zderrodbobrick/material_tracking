import { useState, useEffect } from 'react'
import {
  Clock, Gauge, Zap, Timer, TrendingUp, Trophy, Factory,
  BarChart3, CalendarDays, Hourglass, Percent, Users,
} from 'lucide-react'
import { apiFetch } from '../api'
import { Panel } from '../components/Panel'
import { VerticalBars, HorizontalBars, AreaChart, Donut } from '../components/charts'
import { formatDwell } from '../components/DwellTimer'

function hourLabel(h) {
  const ampm = h < 12 ? 'AM' : 'PM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${ampm}`
}

function Kpi({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="animate-fade-in-scale rounded-xl p-4 flex flex-col gap-2
                    bg-white border border-gray-200 shadow-sm
                    dark:bg-slate-800/60 dark:border-slate-700/60">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">{label}</p>
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent.bg}`}>
          <Icon className={`w-4 h-4 ${accent.icon}`} />
        </span>
      </div>
      <p className={`text-2xl font-bold leading-tight ${accent.text}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-slate-500">{sub}</p>}
    </div>
  )
}

const ACCENTS = {
  violet: { bg: 'bg-violet-50 dark:bg-violet-500/10', icon: 'text-violet-600 dark:text-violet-400', text: 'text-violet-700 dark:text-violet-300' },
  blue:   { bg: 'bg-blue-50 dark:bg-blue-500/10',     icon: 'text-blue-600 dark:text-blue-400',     text: 'text-blue-700 dark:text-blue-400' },
  green:  { bg: 'bg-green-50 dark:bg-green-500/10',   icon: 'text-green-600 dark:text-green-400',   text: 'text-green-700 dark:text-green-400' },
  amber:  { bg: 'bg-amber-50 dark:bg-amber-500/10',   icon: 'text-amber-600 dark:text-amber-400',   text: 'text-amber-700 dark:text-amber-400' },
  slate:  { bg: 'bg-slate-100 dark:bg-slate-700/40',  icon: 'text-slate-500 dark:text-slate-400',   text: 'text-slate-700 dark:text-slate-300' },
}

function Empty({ children }) {
  return <p className="text-sm text-gray-400 dark:text-slate-500 py-10 text-center">{children}</p>
}

export function AnalyticsPage({ tick }) {
  const [a, setA] = useState(null)

  useEffect(() => {
    let alive = true
    apiFetch('/api/analytics')
      .then(res => { if (alive) setA(res) })
      .catch(() => {})
    return () => { alive = false }
  }, [tick])

  if (!a) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-white border border-gray-200 dark:bg-slate-800/60 dark:border-slate-700/60 animate-pulse" />
        ))}
      </div>
    )
  }

  const t = a.totals
  const dwell = a.dwell

  const statusSegments = [
    { label: 'Completed',   value: t.complete,    dot: 'bg-green-500',  stroke: 'stroke-green-500' },
    { label: 'In Process',  value: t.in_progress, dot: 'bg-blue-500',   stroke: 'stroke-blue-500' },
    { label: 'Exit Only',   value: t.exit_only,   dot: 'bg-orange-500', stroke: 'stroke-orange-500' },
    { label: 'Abandoned',   value: t.abandoned,   dot: 'bg-slate-400',  stroke: 'stroke-slate-400' },
  ].filter(s => s.value > 0)

  const dayData = a.throughput_by_day.map(d => ({
    label: d.date,
    short: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
    value: d.completed,
  }))

  const hourData = a.throughput_by_hour.map(h => ({
    label: hourLabel(h.hour),
    short: h.hour % 3 === 0 ? hourLabel(h.hour) : '',
    value: h.completed,
  }))

  const stationData = a.stations.map(s => ({
    label: s.station,
    value: s.avg_dwell_seconds,
    display: s.avg_dwell_display,
  }))

  const distData = a.dwell_distribution.map(d => ({ label: d.label, value: d.count }))

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi icon={Clock} label="Avg Dwell" value={dwell.avg_display ?? '—'}
             sub={`${dwell.sample_size} completed`} accent={ACCENTS.violet} />
        <Kpi icon={Gauge} label="Median Dwell" value={dwell.median_display ?? '—'} accent={ACCENTS.blue} />
        <Kpi icon={Zap} label="Fastest" value={dwell.fastest_display ?? '—'} accent={ACCENTS.green} />
        <Kpi icon={Timer} label="Slowest" value={dwell.slowest_display ?? '—'} accent={ACCENTS.amber} />
        <Kpi icon={Percent} label="Completion Rate"
             value={a.completion_rate != null ? `${a.completion_rate}%` : '—'} accent={ACCENTS.green} />
        <Kpi icon={TrendingUp} label="Total Completed" value={t.complete} accent={ACCENTS.slate} />
      </div>

      {/* Longest station highlight + status mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Slowest Station" icon={Trophy} iconColor="text-amber-500 dark:text-amber-400"
               subtitle="Highest average dwell time">
          <div className="px-5 py-6">
            {a.longest_station ? (
              <div className="flex items-center gap-4">
                <span className="flex items-center justify-center w-14 h-14 rounded-xl
                                 bg-amber-50 dark:bg-amber-500/10">
                  <Factory className="w-7 h-7 text-amber-500 dark:text-amber-400" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{a.longest_station.station}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                    Avg <span className="font-semibold text-amber-600 dark:text-amber-400">{a.longest_station.avg_dwell_display}</span>
                    {' '}· {a.longest_station.completed} parts
                  </p>
                </div>
              </div>
            ) : <Empty>Not enough data yet</Empty>}
          </div>
        </Panel>

        <Panel title="Status Mix" icon={BarChart3} className="lg:col-span-2">
          <div className="px-5 py-6">
            {statusSegments.length ? (
              <Donut segments={statusSegments} centerValue={t.total} centerLabel="Total" />
            ) : <Empty>No sessions recorded yet</Empty>}
          </div>
        </Panel>
      </div>

      {/* Throughput trend */}
      <Panel title="Throughput — Last 14 Days" icon={CalendarDays}
             subtitle="Parts completed per day">
        <div className="px-5 py-5">
          {dayData.some(d => d.value > 0)
            ? <AreaChart data={dayData} formatValue={v => `${v} parts`} />
            : <Empty>No completed parts in the last 14 days</Empty>}
        </div>
      </Panel>

      {/* Hour-of-day + dwell distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Busiest Hours" icon={Hourglass}
               subtitle={a.busiest_hour ? `Peak at ${hourLabel(a.busiest_hour.hour)} (${a.busiest_hour.completed} parts)` : 'By hour of day'}>
          <div className="px-5 py-5">
            {hourData.some(d => d.value > 0)
              ? <VerticalBars data={hourData} accent="blue"
                              highlightIndex={a.busiest_hour ? a.busiest_hour.hour : -1}
                              formatValue={v => `${v} parts`} />
              : <Empty>No completions recorded yet</Empty>}
          </div>
        </Panel>

        <Panel title="Dwell Time Distribution" icon={Clock} iconColor="text-violet-500 dark:text-violet-400"
               subtitle="How long parts spend at the station">
          <div className="px-5 py-5">
            {distData.some(d => d.value > 0)
              ? <HorizontalBars data={distData} accent="violet" formatValue={v => `${v}`} />
              : <Empty>No completed parts yet</Empty>}
          </div>
        </Panel>
      </div>

      {/* Station comparison (avg dwell) */}
      <Panel title="Average Dwell by Station" icon={Factory} iconColor="text-violet-500 dark:text-violet-400"
             subtitle="Lower is faster throughput">
        <div className="px-5 py-5">
          <HorizontalBars data={stationData} accent="amber" emptyText="No completed parts yet" />
        </div>
      </Panel>

      {/* Longest individual parts */}
      <Panel title="Longest Dwell Times" icon={Trophy} iconColor="text-amber-500 dark:text-amber-400"
             subtitle="Top 10 slowest completed parts">
        {a.longest_parts.length === 0 ? (
          <Empty>No completed parts yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                  {['#', 'Part / EPC', 'Dwell', 'Completed'].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap text-gray-600 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {a.longest_parts.map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{p.part_name ?? p.ibus_number ?? p.epc}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                      {p.dwell_time_display ?? formatDwell(p.dwell_seconds)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                      {p.exit_time ? new Date(p.exit_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Operator analytics — coming soon */}
      <Panel title="Operator Analytics" icon={Users} iconColor="text-slate-400 dark:text-slate-500">
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Per-operator performance and throughput will appear here once operator association is added.
          </p>
          <span className="inline-block mt-3 text-xs font-medium px-3 py-1 rounded-full
                           bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">
            Coming soon
          </span>
        </div>
      </Panel>
    </div>
  )
}
