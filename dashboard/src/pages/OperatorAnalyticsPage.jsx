import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, MapPin, Clock, Award, ArrowLeft, Radio, Activity,
  Factory, Search, User, LayoutGrid,
} from 'lucide-react'
import { apiFetch } from '../api'
import { Panel } from '../components/Panel'
import { HorizontalBars, VerticalBars } from '../components/charts'

const CARD_COLORS = [
  'from-violet-500/15 to-white dark:to-slate-900/40 border-violet-300/60 dark:border-violet-500/30',
  'from-sky-500/15 to-white dark:to-slate-900/40 border-sky-300/60 dark:border-sky-500/30',
  'from-emerald-500/15 to-white dark:to-slate-900/40 border-emerald-300/60 dark:border-emerald-500/30',
  'from-amber-500/15 to-white dark:to-slate-900/40 border-amber-300/60 dark:border-amber-500/30',
  'from-rose-500/15 to-white dark:to-slate-900/40 border-rose-300/60 dark:border-rose-500/30',
  'from-blue-500/15 to-white dark:to-slate-900/40 border-blue-300/60 dark:border-blue-500/30',
]

function hourLabel(h) {
  const ampm = h < 12 ? 'AM' : 'PM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${ampm}`
}

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

function cardColor(id) {
  return CARD_COLORS[(id ?? 0) % CARD_COLORS.length]
}

function buildHourlyFromRecent(recent) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, assignments: 0 }))
  for (const r of recent) {
    if (!r.assigned_at) continue
    try {
      const h = new Date(r.assigned_at).getHours()
      buckets[h].assignments += 1
    } catch { /* ignore */ }
  }
  return buckets
}

async function loadOperatorData() {
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
      summary: op.summary ?? {},
      leaderboard: op.leaderboard ?? [],
      presence: {},
      currently_in_zone: [],
      station_coverage: [],
      assignments_by_hour: [],
      roster: (operators ?? []).map(o => {
        const stats = lbMap.get(o.operator_id)
        return {
          operator_id: o.operator_id,
          operator_name: o.operator_name,
          employee_number: o.employee_number,
          rtls_badge_id: o.rtls_badge_id,
          is_active: !!o.is_active,
          sessions: stats?.total_pieces ?? 0,
          stations: stats?.stations_worked ?? 0,
          last_assigned_at: null,
          completed_pieces: stats?.completed_pieces ?? 0,
          in_progress: stats?.in_progress ?? 0,
        }
      }),
      recent_assignments: [],
      multi_station_operators: [],
      _fallback: true,
    }
  }
}

function StationToggle({ stations, active, onChange }) {
  if (!stations.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mr-1">
        Station
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
          ${active == null
            ? 'bg-violet-600 text-white shadow-sm'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-700'}`}
      >
        <span className="inline-flex items-center gap-1">
          <LayoutGrid className="w-3 h-3" />
          All
        </span>
      </button>
      {stations.map(s => (
        <button
          key={s.station}
          type="button"
          onClick={() => onChange(s.station)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
            ${active === s.station
              ? 'bg-violet-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-700'}`}
        >
          {s.station}
          <span className={`ml-1.5 tabular-nums ${active === s.station ? 'text-violet-200' : 'text-violet-600 dark:text-violet-400'}`}>
            {s.pieces ?? 0}
          </span>
        </button>
      ))}
    </div>
  )
}

function OperatorCard({ op, inZone, rank, onClick }) {
  const live = inZone?.station_name
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative aspect-[4/3] min-h-[9rem] rounded-xl border bg-gradient-to-b
                  overflow-hidden flex flex-col shadow-sm text-left p-4
                  hover:brightness-[1.03] focus:outline-none focus-visible:ring-2
                  focus-visible:ring-violet-400 cursor-pointer transition-all
                  ${cardColor(op.operator_id)}`}
    >
      {live && (
        <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px]
                         font-semibold text-sky-600 dark:text-sky-300">
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
          Live
        </span>
      )}
      {rank > 0 && rank <= 3 && (
        <span className="absolute top-2.5 left-2.5 text-[10px] font-bold tabular-nums
                         text-amber-600 dark:text-amber-400">#{rank}</span>
      )}
      <div className="flex items-center gap-2.5 mt-1">
        <span className="flex items-center justify-center w-10 h-10 rounded-full
                         bg-white/80 dark:bg-slate-800/80 shrink-0">
          <User className="w-5 h-5 text-violet-500 dark:text-violet-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-gray-900 dark:text-slate-100 leading-snug truncate">
            {op.operator_name}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
            Badge {op.rtls_badge_id ?? '—'}
          </p>
        </div>
      </div>
      <div className="mt-auto pt-3 space-y-1">
        {live && (
          <p className="text-[11px] text-sky-700 dark:text-sky-300 truncate flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0" />
            {live}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="tabular-nums font-semibold text-green-600 dark:text-green-400">
            {op.completed_pieces ?? op.sessions ?? 0} pieces
          </span>
          <span className="text-gray-400 dark:text-slate-500 tabular-nums">
            {op.stations ?? 0} stations
          </span>
        </div>
      </div>
    </button>
  )
}

function OperatorDetailView({
  operatorId,
  leaderboardStats,
  rosterRow,
  inZoneProp,
  globalRecent,
  onBack,
  tick = 0,
}) {
  const [detail, setDetail] = useState(null)
  const [stationFilter, setStationFilter] = useState(null)

  useEffect(() => {
    let alive = true
    setStationFilter(null)
    apiFetch(`/api/analytics/operators/${operatorId}`)
      .then(d => { if (alive) setDetail(d) })
      .catch(() => { if (alive) setDetail(null) })
    return () => { alive = false }
  }, [operatorId, tick])

  const stats = detail?.stats ?? leaderboardStats
  const op = detail?.operator ?? rosterRow
  const inZone = detail?.currently_in_zone ?? inZoneProp
  const stations = useMemo(() => {
    const fromDetail = detail?.stations ?? []
    const fromLb = stats?.stations ?? []
    const fromZones = detail?.zone_dwell_by_station ?? []
    const merged = new Map()
    for (const s of fromDetail.length ? fromDetail : fromLb.map(x => ({
      station: x.station,
      pieces: x.pieces ?? 0,
      completed: x.completed ?? x.pieces ?? 0,
      avg_dwell_display: x.avg_dwell_display,
      avg_dwell_seconds: x.avg_dwell_seconds,
    }))) {
      merged.set(s.station, { ...s })
    }
    for (const z of fromZones) {
      const existing = merged.get(z.station) ?? { station: z.station, pieces: 0, completed: 0 }
      merged.set(z.station, {
        ...existing,
        zone_visits: z.visits,
        zone_avg_dwell_display: z.avg_dwell_display,
        zone_total_dwell_display: z.total_dwell_display,
      })
    }
    return [...merged.values()].sort((a, b) => (b.pieces ?? 0) - (a.pieces ?? 0))
  }, [detail, stats])

  const zoneVisits = detail?.zone_visits ?? []
  const filteredZoneVisits = useMemo(() => {
    if (!stationFilter) return zoneVisits
    return zoneVisits.filter(v => v.station_name === stationFilter)
  }, [zoneVisits, stationFilter])

  const activeZoneStation = useMemo(() => {
    if (!stationFilter) return null
    return (detail?.zone_dwell_by_station ?? []).find(z => z.station === stationFilter) ?? null
  }, [detail, stationFilter])

  const operatorName = op?.operator_name ?? rosterRow?.operator_name ?? 'Operator'

  const allRecent = useMemo(() => {
    const fromApi = detail?.recent_assignments ?? []
    if (fromApi.length) return fromApi
    const name = operatorName.toLowerCase()
    return (globalRecent ?? []).filter(r =>
      (r.operator_name ?? '').toLowerCase() === name
      || r.operator_id === operatorId,
    )
  }, [detail, globalRecent, operatorName, operatorId])

  const filteredRecent = useMemo(() => {
    if (!stationFilter) return allRecent
    return allRecent.filter(r => r.station_name === stationFilter)
  }, [allRecent, stationFilter])

  const activeStation = useMemo(
    () => stations.find(s => s.station === stationFilter) ?? null,
    [stations, stationFilter],
  )

  const byHour = useMemo(() => {
    if (stationFilter) return buildHourlyFromRecent(filteredRecent)
    if (detail?.assignments_by_hour?.length) return detail.assignments_by_hour
    return buildHourlyFromRecent(allRecent)
  }, [detail, stationFilter, filteredRecent, allRecent])

  const hourChart = byHour.map(h => ({
    label: hourLabel(h.hour),
    short: h.hour % 3 === 0 ? hourLabel(h.hour) : '',
    value: h.assignments,
  }))

  const stationBars = stations.map(s => ({
    label: s.station,
    value: s.pieces ?? 0,
    display: `${s.pieces ?? 0} pcs`,
  }))

  const kpis = stationFilter && activeStation
    ? [
        ['Pieces at station', activeStation.pieces ?? 0, 'text-green-600 dark:text-green-400'],
        ['Completed', activeStation.completed ?? activeStation.pieces ?? 0, 'text-emerald-600 dark:text-emerald-400'],
        ['Avg dwell', activeStation.avg_dwell_display ?? '—', 'text-gray-900 dark:text-slate-100 font-mono'],
        ['Zone visits', activeZoneStation?.visits ?? filteredZoneVisits.length, 'text-sky-600 dark:text-sky-400'],
      ]
    : [
        ['Completed', stats?.completed_pieces ?? rosterRow?.completed_pieces ?? 0, 'text-green-600 dark:text-green-400'],
        ['In progress', stats?.in_progress ?? rosterRow?.in_progress ?? 0, 'text-blue-600 dark:text-blue-400'],
        ['Stations', stats?.stations_worked ?? stations.length, 'text-violet-600 dark:text-violet-400'],
        ['Avg dwell', stats?.avg_dwell_display ?? '—', 'text-gray-900 dark:text-slate-100 font-mono'],
      ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                     border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300
                     hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          All operators
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">{operatorName}</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Badge {op?.rtls_badge_id ?? rosterRow?.rtls_badge_id ?? '—'}
          </p>
        </div>
        {inZone && (
          <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs
                           font-semibold bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
            <Radio className="w-3.5 h-3.5" />
            In zone: {inZone.station_name ?? inZone}
          </span>
        )}
      </div>

      <StationToggle
        stations={stations}
        active={stationFilter}
        onChange={setStationFilter}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(([label, val, cls]) => (
          <div key={label} className="rounded-xl border border-gray-200 dark:border-slate-700/60
                                      bg-white dark:bg-slate-800/60 p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums truncate ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {stationFilter && activeStation && (
        <Panel
          title={`${stationFilter} breakdown`}
          icon={Factory}
          iconColor="text-violet-500"
          subtitle="Stats for this station only"
        >
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg bg-violet-50/80 dark:bg-violet-500/10 p-4 border border-violet-200/60 dark:border-violet-500/25">
              <p className="text-[10px] uppercase tracking-wider text-violet-600/80 dark:text-violet-300/80">Pieces</p>
              <p className="text-3xl font-bold tabular-nums text-violet-700 dark:text-violet-300 mt-1">
                {activeStation.pieces ?? 0}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50/80 dark:bg-emerald-500/10 p-4 border border-emerald-200/60 dark:border-emerald-500/25">
              <p className="text-[10px] uppercase tracking-wider text-emerald-600/80 dark:text-emerald-300/80">Completed</p>
              <p className="text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">
                {activeStation.completed ?? activeStation.pieces ?? 0}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 p-4 border border-gray-200 dark:border-slate-700/60">
              <p className="text-[10px] uppercase tracking-wider text-gray-400">Avg dwell</p>
              <p className="text-3xl font-bold font-mono text-gray-900 dark:text-slate-100 mt-1">
                {activeStation.avg_dwell_display ?? '—'}
              </p>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {!stationFilter && (
          <Panel title="All Stations" icon={Factory} iconColor="text-blue-500"
                 subtitle="Pieces attributed at each machine">
            <div className="px-5 py-5">
              {stationBars.length > 0
                ? <HorizontalBars data={stationBars} accent="blue" />
                : <p className="text-sm text-gray-400 py-8 text-center">No machine data yet — run sim with demo operators</p>}
            </div>
          </Panel>
        )}

        <Panel
          title="Activity by Hour"
          icon={Activity}
          iconColor="text-violet-500"
          subtitle={stationFilter ? `Assignments at ${stationFilter}` : 'All stations combined'}
        >
          <div className="px-4 py-4">
            {hourChart.some(h => h.value > 0)
              ? <VerticalBars data={hourChart} accent="violet" />
              : <p className="text-sm text-gray-400 py-8 text-center">No hourly data for this view</p>}
          </div>
        </Panel>
      </div>

      <Panel
        title="Zone Movement History"
        icon={MapPin}
        iconColor="text-sky-500"
        subtitle={stationFilter ? `RTLS visits at ${stationFilter}` : 'Random station-to-station dwell (min 5s)'}
      >
        {filteredZoneVisits.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {stationFilter
              ? `No zone visits at ${stationFilter} yet — run sim with operator movement`
              : 'No zone visits yet — start sim to see operators roam between stations'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                  {['Entered', 'Exited', 'Station', 'Dwell', 'Source'].map(h => (
                    <th key={h} className="px-4 py-3 font-semibold text-xs text-gray-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {filteredZoneVisits.map((v, i) => (
                  <tr key={`${v.entered_at}-${i}`} className="hover:bg-gray-50 dark:hover:bg-slate-700/20">
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatWhen(v.entered_at)}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {v.exited_at ? formatWhen(v.exited_at) : (
                        <span className="text-sky-600 dark:text-sky-400 font-medium">In zone</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{v.station_name ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{v.dwell_display ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs capitalize text-gray-500">{v.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Recent Work"
        icon={Clock}
        iconColor="text-green-500"
        subtitle={stationFilter ? `Parts at ${stationFilter}` : 'Latest parts this operator worked on'}
      >
        {filteredRecent.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {stationFilter
              ? `No recorded work at ${stationFilter} yet`
              : 'No assignments recorded yet — restart API after sim for full history'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-gray-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700/60">
                  {['When', 'Station', 'Part EPC', 'Dwell', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 font-semibold text-xs text-gray-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {filteredRecent.map((r, i) => (
                  <tr key={`${r.assigned_at}-${i}`} className="hover:bg-gray-50 dark:hover:bg-slate-700/20">
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatWhen(r.assigned_at)}</td>
                    <td className="px-4 py-2.5">{r.station_name ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px]">{r.epc ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{r.dwell_display ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs capitalize">{r.session_status ?? '—'}</td>
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

export function OperatorAnalyticsPage({ tick = 0 }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const load = useCallback(() => {
    loadOperatorData()
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
    for (const z of data?.currently_in_zone ?? []) {
      m.set(z.operator_id, z)
    }
    return m
  }, [data])

  const rankMap = useMemo(() => {
    const m = new Map()
    ;(data?.leaderboard ?? []).forEach((o, i) => m.set(o.operator_id, i + 1))
    return m
  }, [data])

  const leaderboardMap = useMemo(
    () => new Map((data?.leaderboard ?? []).map(o => [o.operator_id, o])),
    [data],
  )

  const cards = useMemo(() => {
    const roster = data?.roster ?? []
    return roster
      .filter(r => r.is_active !== false)
      .map(r => {
        const stats = leaderboardMap.get(r.operator_id)
        return {
          ...r,
          completed_pieces: stats?.completed_pieces ?? r.completed_pieces ?? 0,
          in_progress: stats?.in_progress ?? r.in_progress ?? 0,
          stations: stats?.stations_worked ?? r.stations ?? 0,
        }
      })
      .sort((a, b) => (b.completed_pieces - a.completed_pieces) || a.operator_name.localeCompare(b.operator_name))
  }, [data, leaderboardMap])

  const filteredCards = useMemo(() => {
    if (!search.trim()) return cards
    const q = search.trim().toLowerCase()
    return cards.filter(c =>
      `${c.operator_name} ${c.rtls_badge_id} ${c.employee_number}`.toLowerCase().includes(q),
    )
  }, [cards, search])

  if (selectedId != null) {
    return (
      <OperatorDetailView
        operatorId={selectedId}
        leaderboardStats={leaderboardMap.get(selectedId)}
        rosterRow={cards.find(c => c.operator_id === selectedId)}
        inZoneProp={inZoneMap.get(selectedId)}
        globalRecent={data?.recent_assignments}
        onBack={() => setSelectedId(null)}
        tick={tick}
      />
    )
  }

  if (!data && !error) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] rounded-xl bg-white border border-gray-200
                                  dark:bg-slate-800/60 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-500" />
            Operators
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Click an operator — toggle stations inside for per-machine stats
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-8 pr-3 py-1.5 text-sm rounded-md w-48 border border-gray-300 bg-white
                       dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {data?.summary?.top_operator && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
          <Award className="w-4 h-4 text-amber-500" />
          Top: <span className="font-semibold text-gray-800 dark:text-slate-200">
            {data.summary.top_operator.operator_name}
          </span>
          <span className="tabular-nums">({data.summary.top_operator.pieces} pieces)</span>
        </div>
      )}

      {filteredCards.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-16">No operators match</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredCards.map(op => (
            <OperatorCard
              key={op.operator_id}
              op={op}
              inZone={inZoneMap.get(op.operator_id)}
              rank={rankMap.get(op.operator_id) ?? 0}
              onClick={() => setSelectedId(op.operator_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
