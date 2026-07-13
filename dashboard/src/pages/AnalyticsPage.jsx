import { useState, useEffect } from 'react'
import {
  Clock, Gauge, Zap, Timer, TrendingUp, Trophy, Factory,
  BarChart3, CalendarDays, Hourglass, Percent, Users, Package,
  MapPin, Award,
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

const ANALYTICS_TABS = [
  { id: 'parts',     label: 'Parts',     icon: Package },
  { id: 'operators', label: 'Operators', icon: Users },
]

function AnalyticsTabs({ active, onChange }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/60 w-fit">
      {ANALYTICS_TABS.map(t => {
        const Icon = t.icon
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                        ${isActive
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-violet-600 dark:text-violet-400' : ''}`} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function PartsTab({ a }) {
  const t = a.totals
  const dwell = a.dwell
  const ps = a.parts_summary ?? {}

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

  const typeData = (ps.part_type_distribution ?? []).map(d => ({
    label: d.part_type,
    value: d.count,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi icon={Package} label="Unique Parts" value={ps.unique_epcs_completed ?? '—'}
             sub="Distinct EPCs completed" accent={ACCENTS.blue} />
        <Kpi icon={Factory} label="IBUS Orders" value={ps.unique_ibus_orders ?? '—'}
             sub="Distinct work orders" accent={ACCENTS.violet} />
        <Kpi icon={MapPin} label="Avg Stations / Part" value={ps.avg_stations_per_part ?? '—'}
             sub="Stations visited per tag" accent={ACCENTS.green} />
        <Kpi icon={Clock} label="Avg Dwell" value={dwell.avg_display ?? '—'}
             sub={`${dwell.sample_size} completed`} accent={ACCENTS.violet} />
        <Kpi icon={Percent} label="Completion Rate"
             value={a.completion_rate != null ? `${a.completion_rate}%` : '—'} accent={ACCENTS.green} />
        <Kpi icon={TrendingUp} label="Total Completed" value={t.complete} accent={ACCENTS.slate} />
      </div>

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

      <Panel title="Throughput — Last 14 Days" icon={CalendarDays}
             subtitle="Parts completed per day">
        <div className="px-5 py-5">
          {dayData.some(d => d.value > 0)
            ? <AreaChart data={dayData} formatValue={v => `${v} parts`} />
            : <Empty>No completed parts in the last 14 days</Empty>}
        </div>
      </Panel>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Average Dwell by Station" icon={Factory} iconColor="text-violet-500 dark:text-violet-400"
               subtitle="Lower is faster throughput">
          <div className="px-5 py-5">
            <HorizontalBars data={stationData} accent="amber" emptyText="No completed parts yet" />
          </div>
        </Panel>

        {typeData.length > 0 && (
          <Panel title="Part Type Mix" icon={Package} iconColor="text-blue-500 dark:text-blue-400"
                 subtitle="Completed sessions by part type">
            <div className="px-5 py-5">
              <HorizontalBars data={typeData} accent="blue" formatValue={v => `${v}`} />
            </div>
          </Panel>
        )}
      </div>

      <Panel title="Longest Dwell Times" icon={Trophy} iconColor="text-amber-500 dark:text-amber-400"
             subtitle="Top 10 slowest completed parts at a single station">
        {a.longest_parts.length === 0 ? (
          <Empty>No completed parts yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                  {['#', 'Part / EPC', 'Station', 'Dwell', 'Completed'].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap text-gray-600 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {a.longest_parts.map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{p.part_name ?? p.ibus_number ?? p.epc}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">{p.station_name ?? '—'}</td>
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

      <Panel title="Longest Line Times" icon={Timer} iconColor="text-violet-500 dark:text-violet-400"
             subtitle="End-to-end time per part tag across all stations">
        {(ps.longest_line_times ?? []).length === 0 ? (
          <Empty>No completed parts yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                  {['#', 'EPC', 'Stations', 'Total Line Time'].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap text-gray-600 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {ps.longest_line_times.map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{p.epc}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-slate-300">{p.stations_visited}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-violet-600 dark:text-violet-400 whitespace-nowrap">
                      {p.total_line_display ?? formatDwell(p.total_line_seconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function OperatorsTab({ a }) {
  const op = a.operators ?? {}
  const summary = op.summary ?? {}
  const leaderboard = op.leaderboard ?? []
  const top = summary.top_operator

  const barData = leaderboard.slice(0, 10).map(o => ({
    label: o.operator_name ?? `Operator ${o.operator_id}`,
    value: o.completed_pieces,
    display: `${o.completed_pieces}`,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <Kpi icon={Users} label="Active Operators" value={summary.active_operators ?? 0}
             sub="With attributed sessions" accent={ACCENTS.blue} />
        <Kpi icon={Package} label="Pieces Attributed" value={summary.total_pieces_attributed ?? 0}
             sub="Completed with operator" accent={ACCENTS.violet} />
        <Kpi icon={Award} label="Top Operator"
             value={top?.operator_name ?? '—'}
             sub={top ? `${top.pieces} pieces completed` : undefined} accent={ACCENTS.amber} />
        <Kpi icon={Percent} label="RTLS Match Rate"
             value={summary.rtls_match_rate != null ? `${summary.rtls_match_rate}%` : '—'}
             sub={`${summary.open_with_operator ?? 0} of ${summary.open_sessions ?? 0} open`} accent={ACCENTS.green} />
        <Kpi icon={Clock} label="Avg Dwell"
             value={leaderboard.length
               ? formatDwell(Math.round(
                   leaderboard.reduce((s, o) => s + (o.avg_dwell_seconds ?? 0), 0) / leaderboard.length
                 ))
               : '—'}
             sub="Across all operators" accent={ACCENTS.slate} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Pieces Completed" icon={Trophy} iconColor="text-amber-500 dark:text-amber-400"
               subtitle="Top operators by completed pieces">
          <div className="px-5 py-5">
            {barData.length > 0
              ? <HorizontalBars data={barData} accent="amber" formatValue={v => `${v} pieces`} />
              : <Empty>No operator data yet — RTLS assignments appear once operators are confirmed at machines</Empty>}
          </div>
        </Panel>

        {top && (
          <Panel title="Top Performer" icon={Award} iconColor="text-amber-500 dark:text-amber-400"
                 subtitle="Most completed pieces">
            <div className="px-5 py-6">
              <div className="flex items-center gap-4">
                <span className="flex items-center justify-center w-14 h-14 rounded-xl
                                 bg-amber-50 dark:bg-amber-500/10">
                  <Users className="w-7 h-7 text-amber-500 dark:text-amber-400" />
                </span>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{top.operator_name}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                    <span className="font-semibold text-amber-600 dark:text-amber-400">{top.pieces}</span> pieces completed
                  </p>
                </div>
              </div>
            </div>
          </Panel>
        )}
      </div>

      <Panel title="Operator Leaderboard" icon={Users} iconColor="text-blue-500 dark:text-blue-400"
             subtitle="Total pieces and per-machine breakdown">
        {leaderboard.length === 0 ? (
          <Empty>No operator assignments recorded yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                  {['#', 'Operator', 'Completed', 'In Progress', 'Stations', 'Avg Dwell', 'Per Machine'].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap text-gray-600 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {leaderboard.map((o, i) => (
                  <tr key={o.operator_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors align-top">
                    <td className="px-4 py-3 text-gray-400 dark:text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{o.operator_name}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-green-600 dark:text-green-400">{o.completed_pieces}</td>
                    <td className="px-4 py-3 tabular-nums text-blue-600 dark:text-blue-400">{o.in_progress || '—'}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600 dark:text-slate-300">{o.stations_worked}</td>
                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-slate-300 whitespace-nowrap">
                      {o.avg_dwell_display ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(o.stations ?? []).map(st => (
                          <span key={st.station}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs
                                           bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300"
                                title={st.avg_dwell_display ? `Avg ${st.avg_dwell_display}` : undefined}>
                            <span className="font-medium">{st.station}</span>
                            <span className="tabular-nums font-semibold text-violet-600 dark:text-violet-400">{st.pieces}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

export function AnalyticsPage({ tick }) {
  const [a, setA] = useState(null)
  const [tab, setTab] = useState('parts')

  useEffect(() => {
    let alive = true
    apiFetch('/api/analytics')
      .then(res => { if (alive) setA(res) })
      .catch(() => {})
    return () => { alive = false }
  }, [tick])

  if (!a) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 rounded-xl bg-gray-200 dark:bg-slate-700 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-white border border-gray-200 dark:bg-slate-800/60 dark:border-slate-700/60 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnalyticsTabs active={tab} onChange={setTab} />
      {tab === 'parts' ? <PartsTab a={a} /> : <OperatorsTab a={a} />}
    </div>
  )
}
