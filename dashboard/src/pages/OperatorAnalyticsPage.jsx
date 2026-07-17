import { useCallback, useEffect, useMemo, useState } from 'react'
import {
 Users, MapPin, Clock, Award, ArrowLeft, Radio, Activity,
 Factory, Search, User, LayoutGrid,
} from 'lucide-react'
import { apiFetch } from '../api'
import { Panel } from '../components/Panel'
import { HorizontalBars, VerticalBars } from '../components/charts'

const CARD_COLORS = [
 'from-[#4dc4f4]/10 to-[#18181d] border-[#4dc4f4]/25',
 'from-[#4dc4f4]/10 to-[#18181d] border-[#4dc4f4]/25',
 'from-[#34d399]/10 to-[#18181d] border-[#34d399]/25',
 'from-[#fbbf24]/10 to-[#18181d] border-[#fbbf24]/25',
 'from-[#f87171]/10 to-[#18181d] border-[#f87171]/25',
 'from-[#4dc4f4]/10 to-[#18181d] border-[#4dc4f4]/25',
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
   <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8b939e] mr-1">
    Station
   </span>
   <button
    type="button"
    onClick={() => onChange(null)}
    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
     ${active == null
      ? 'bg-violet-600 text-white shadow-sm'
      : 'bg-[#27272f] text-[#8b939e] hover:bg-[#27272f]/60 dark:text-[#8b939e] hover:bg-[#4dc4f4]/10'}`}
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
       : 'bg-[#27272f] text-[#8b939e] hover:bg-[#27272f]/60 dark:text-[#8b939e] hover:bg-[#4dc4f4]/10'}`}
    >
     {s.station}
     <span className={`ml-1.5 tabular-nums ${active === s.station ? 'text-violet-200' : 'text-[#4dc4f4]'}`}>
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
 font-semibold text-[#4dc4f4]">
     <span className="w-2 h-2 rounded-full bg-[#4dc4f4]/100 animate-pulse" />
     Live
    </span>
   )}
   {rank > 0 && rank <= 3 && (
    <span className="absolute top-2.5 left-2.5 text-[10px] font-bold tabular-nums
 text-[#fbbf24]">#{rank}</span>
   )}
   <div className="flex items-center gap-2.5 mt-1">
    <span className="flex items-center justify-center w-10 h-10 rounded-full
 bg-[#18181d]/80 bg-[#18181d]/80 shrink-0">
     <User className="w-5 h-5 text-[#4dc4f4]" />
    </span>
    <div className="min-w-0 flex-1">
     <p className="font-semibold text-sm text-[#eef2f7] leading-snug truncate">
      {op.operator_name}
     </p>
     <p className="text-[11px] text-[#8b939e] truncate">
      Badge {op.rtls_badge_id ?? '—'}
     </p>
    </div>
   </div>
   <div className="mt-auto pt-3 space-y-1">
    {live && (
     <p className="text-[11px] text-[#4dc4f4] truncate flex items-center gap-1">
      <MapPin className="w-3 h-3 shrink-0" />
      {live}
     </p>
    )}
    <div className="flex items-center justify-between gap-2 text-xs">
     <span className="tabular-nums font-semibold text-[#34d399]">
      {op.completed_pieces ?? op.sessions ?? 0} pieces
     </span>
     <span className="text-[#8b939e] tabular-nums">
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
    ['Pieces at station', activeStation.pieces ?? 0, 'text-[#34d399]'],
    ['Completed', activeStation.completed ?? activeStation.pieces ?? 0, 'text-[#34d399]'],
    ['Avg dwell', activeStation.avg_dwell_display ?? '—', 'text-[#eef2f7] font-mono'],
    ['Zone visits', activeZoneStation?.visits ?? filteredZoneVisits.length, 'text-[#4dc4f4]'],
   ]
  : [
    ['Completed', stats?.completed_pieces ?? rosterRow?.completed_pieces ?? 0, 'text-[#34d399]'],
    ['In progress', stats?.in_progress ?? rosterRow?.in_progress ?? 0, 'text-[#4dc4f4]'],
    ['Stations', stats?.stations_worked ?? stations.length, 'text-[#4dc4f4]'],
    ['Avg dwell', stats?.avg_dwell_display ?? '—', 'text-[#eef2f7] font-mono'],
   ]

 return (
  <div className="space-y-6">
   <div className="flex flex-wrap items-center gap-3">
    <button
     type="button"
     onClick={onBack}
     className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
 border border-[#27272f] text-[#8b939e] dark:text-[#8b939e]
           hover:bg-[#4dc4f4]/5 hover:bg-[#4dc4f4]/10"
    >
     <ArrowLeft className="w-4 h-4" />
     All operators
    </button>
    <div>
     <h1 className="text-xl font-bold text-[#eef2f7]">{operatorName}</h1>
     <p className="text-sm text-[#8b939e]">
      Badge {op?.rtls_badge_id ?? rosterRow?.rtls_badge_id ?? '—'}
     </p>
    </div>
    {inZone && (
     <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs
 font-semibold bg-sky-100 text-[#4dc4f4] dark:bg-[#4dc4f4]/100/20">
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
     <div key={label} className="rounded-xl border border-[#27272f]
 bg-[#18181d] p-4">
      <p className="text-[10px] uppercase tracking-wider text-[#8b939e]">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums truncate ${cls}`}>{val}</p>
     </div>
    ))}
   </div>

   {stationFilter && activeStation && (
    <Panel
     title={`${stationFilter} breakdown`}
     icon={Factory}
     iconColor="text-[#4dc4f4]"
     subtitle="Stats for this station only"
    >
     <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
      <div className="rounded-lg bg-[#a78bfa]/10/80 dark:bg-[#a78bfa]/100/10 p-4 border border-[#a78bfa]/30/60 border-[#a78bfa]/25">
       <p className="text-[10px] uppercase tracking-wider text-[#a78bfa]/80/80">Pieces</p>
       <p className="text-3xl font-bold tabular-nums text-[#a78bfa] mt-1">
        {activeStation.pieces ?? 0}
       </p>
      </div>
      <div className="rounded-lg bg-[#34d399]/10/80 dark:bg-[#34d399]/100/10 p-4 border border-[#34d399]/30/60 border-[#34d399]/25">
       <p className="text-[10px] uppercase tracking-wider text-[#34d399]/80/80">Completed</p>
       <p className="text-3xl font-bold tabular-nums text-[#34d399] mt-1">
        {activeStation.completed ?? activeStation.pieces ?? 0}
       </p>
      </div>
      <div className="rounded-lg bg-[#08080a]/40 p-4 border border-[#27272f]">
       <p className="text-[10px] uppercase tracking-wider text-[#8b939e]">Avg dwell</p>
       <p className="text-3xl font-bold font-mono text-[#eef2f7] mt-1">
        {activeStation.avg_dwell_display ?? '—'}
       </p>
      </div>
     </div>
    </Panel>
   )}

   <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    {!stationFilter && (
     <Panel title="All Stations" icon={Factory} iconColor="text-[#4dc4f4]"
         subtitle="Pieces attributed at each machine">
      <div className="px-5 py-5">
       {stationBars.length > 0
        ? <HorizontalBars data={stationBars} accent="blue" />
        : <p className="text-sm text-[#8b939e] py-8 text-center">No machine data yet — run sim with demo operators</p>}
      </div>
     </Panel>
    )}

    <Panel
     title="Activity by Hour"
     icon={Activity}
     iconColor="text-[#4dc4f4]"
     subtitle={stationFilter ? `Assignments at ${stationFilter}` : 'All stations combined'}
    >
     <div className="px-4 py-4">
      {hourChart.some(h => h.value > 0)
       ? <VerticalBars data={hourChart} accent="violet" />
       : <p className="text-sm text-[#8b939e] py-8 text-center">No hourly data for this view</p>}
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
     <p className="text-sm text-[#8b939e] py-8 text-center">
      {stationFilter
       ? `No zone visits at ${stationFilter} yet — run sim with operator movement`
       : 'No zone visits yet — start sim to see operators roam between stations'}
     </p>
    ) : (
     <div className="overflow-x-auto">
      <table className="w-full text-sm">
       <thead>
        <tr className="text-left bg-[#08080a] border-b border-[#27272f]">
         {['Entered', 'Exited', 'Station', 'Dwell', 'Source'].map(h => (
          <th key={h} className="px-4 py-3 font-semibold text-xs text-[#8b939e]">{h}</th>
         ))}
        </tr>
       </thead>
       <tbody className="divide-y divide-[#27272f]/50">
        {filteredZoneVisits.map((v, i) => (
         <tr key={`${v.entered_at}-${i}`} className="hover:bg-[#4dc4f4]/5 hover:bg-[#4dc4f4]/10/20">
          <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatWhen(v.entered_at)}</td>
          <td className="px-4 py-2.5 text-xs whitespace-nowrap">
           {v.exited_at ? formatWhen(v.exited_at) : (
            <span className="text-[#4dc4f4] font-medium">In zone</span>
           )}
          </td>
          <td className="px-4 py-2.5">{v.station_name ?? '—'}</td>
          <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{v.dwell_display ?? '—'}</td>
          <td className="px-4 py-2.5 text-xs capitalize text-[#8b939e]">{v.source ?? '—'}</td>
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
    iconColor="text-[#34d399]"
    subtitle={stationFilter ? `Parts at ${stationFilter}` : 'Latest parts this operator worked on'}
   >
    {filteredRecent.length === 0 ? (
     <p className="text-sm text-[#8b939e] py-8 text-center">
      {stationFilter
       ? `No recorded work at ${stationFilter} yet`
       : 'No assignments recorded yet — restart API after sim for full history'}
     </p>
    ) : (
     <div className="overflow-x-auto">
      <table className="w-full text-sm">
       <thead>
        <tr className="text-left bg-[#08080a] border-b border-[#27272f]">
         {['When', 'Station', 'Part EPC', 'Dwell', 'Status'].map(h => (
          <th key={h} className="px-4 py-3 font-semibold text-xs text-[#8b939e]">{h}</th>
         ))}
        </tr>
       </thead>
       <tbody className="divide-y divide-[#27272f]/50">
        {filteredRecent.map((r, i) => (
         <tr key={`${r.assigned_at}-${i}`} className="hover:bg-[#4dc4f4]/5 hover:bg-[#4dc4f4]/10/20">
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
     <div key={i} className="aspect-[4/3] rounded-xl bg-[#18181d] border border-[#27272f]
 bg-[#18181d] animate-pulse" />
    ))}
   </div>
  )
 }

 return (
  <div className="space-y-5">
   <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
     <h1 className="text-xl font-bold text-[#eef2f7] flex items-center gap-2">
      <Users className="w-5 h-5 text-[#4dc4f4]" />
      Operators
     </h1>
     <p className="text-sm text-[#8b939e] mt-0.5">
      Click an operator — toggle stations inside for per-machine stats
     </p>
    </div>
    <div className="relative">
     <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#8b939e] pointer-events-none" />
     <input
      type="text"
      value={search}
      onChange={e => setSearch(e.target.value)}
      placeholder="Search…"
      className="pl-8 pr-3 py-1.5 text-sm rounded-md w-48 border border-[#27272f] bg-[#18181d]
 bg-[#08080a] text-[#eef2f7]"
     />
    </div>
   </div>

   {error && <p className="text-sm text-[#f87171]">{error}</p>}

   {data?.summary?.top_operator && (
    <div className="flex items-center gap-2 text-sm text-[#8b939e]">
     <Award className="w-4 h-4 text-[#fbbf24]" />
     Top: <span className="font-semibold text-[#eef2f7]">
      {data.summary.top_operator.operator_name}
     </span>
     <span className="tabular-nums">({data.summary.top_operator.pieces} pieces)</span>
    </div>
   )}

   {filteredCards.length === 0 ? (
    <p className="text-center text-sm text-[#8b939e] py-16">No operators match</p>
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
