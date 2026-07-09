import { useCallback, useEffect, useMemo, useState } from 'react'
import { Map as MapIcon, Radio, Users, AlertCircle, X, Pin, Factory } from 'lucide-react'
import { Panel } from '../components/Panel'
import { LiveQueueTable } from '../components/LiveQueueTable'
import { MachineOverlay } from '../components/MachineOverlay'
import { MachineStatusTable } from '../components/MachineStatusPanel'
import { StationDetailModal } from '../components/StationDetailModal'
import { useRtlsLive } from '../hooks/useRtlsLive'
import { FLOOR_PLAN, sewioToPercentClamped } from '../utils/floorPlanCoords'
import {
  MACHINES,
  PINNABLE_STATIONS,
  PRODUCTION_LINE_ORDER,
  PRODUCTION_LINE_STATIONS,
  operatorsInMachineZone,
} from '../utils/machineRegions'
import { getAllStationStatuses } from '../utils/stationStatus'
import floorPlanImg from '../assets/floor_plan.png'

const MAX_PINNED = PINNABLE_STATIONS.length
const PINNED_STORAGE_KEY = 'liveDashboard.pinnedStations'
const VISIBLE_MACHINES_KEY = 'liveDashboard.visibleMachines'

function defaultVisibleMachines() {
  return PRODUCTION_LINE_STATIONS.map(s => s.station)
}

function loadVisibleMachines() {
  try {
    const raw = localStorage.getItem(VISIBLE_MACHINES_KEY)
    if (!raw) return defaultVisibleMachines()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultVisibleMachines()
    const valid = parsed.filter(s => PRODUCTION_LINE_STATIONS.some(st => st.station === s))
    return valid.length > 0 ? valid : defaultVisibleMachines()
  } catch {
    return defaultVisibleMachines()
  }
}

const MARKER_COLORS = [
  { dot: 'bg-blue-500', ring: 'ring-blue-300', glow: 'shadow-blue-400/60' },
  { dot: 'bg-emerald-500', ring: 'ring-emerald-300', glow: 'shadow-emerald-400/60' },
  { dot: 'bg-violet-500', ring: 'ring-violet-300', glow: 'shadow-violet-400/60' },
  { dot: 'bg-amber-500', ring: 'ring-amber-300', glow: 'shadow-amber-400/60' },
  { dot: 'bg-rose-500', ring: 'ring-rose-300', glow: 'shadow-rose-400/60' },
  { dot: 'bg-cyan-500', ring: 'ring-cyan-300', glow: 'shadow-cyan-400/60' },
]

function stationSortIndex(name) {
  const idx = PRODUCTION_LINE_ORDER.indexOf(name)
  return idx === -1 ? PRODUCTION_LINE_ORDER.length : idx
}

function sortByStationOrder(stations) {
  return [...stations].sort((a, b) => stationSortIndex(a) - stationSortIndex(b))
}

function loadPinnedStations() {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return sortByStationOrder(
      parsed.filter(s => typeof s === 'string' && PINNABLE_STATIONS.includes(s)),
    ).slice(0, MAX_PINNED)
  } catch {
    return []
  }
}

function OperatorMarker({ op, colors, zone, offMap, pos }) {
  const title = [
    op.operator_name || `Tag ${op.tag_id}`,
    `x=${Number(op.x).toFixed(1)} y=${Number(op.y).toFixed(1)}`,
    zone?.zone_name,
    offMap ? '(off map — clamped to edge)' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      data-floor-marker
      className="absolute z-20 pointer-events-auto"
      style={{
        left: pos.left,
        top: pos.top,
        transform: 'translate(-50%, -50%)',
        transition: 'left 80ms linear, top 80ms linear',
      }}
      title={title}
    >
      <span
        className={`relative flex items-center justify-center w-2 h-2 rounded-full
                    ring-2 ring-white/80 shadow-[0_0_12px_rgba(255,255,255,0.45)]
                    ${colors.dot}
                    ${offMap ? 'opacity-60' : ''}`}
      >
        <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-sky-400 [animation-duration:1.5s]" />
        <span className="relative w-2.5 h-2.5 rounded-full bg-white" />
      </span>
      <span
        className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap
                   px-1 py-px rounded text-[7px] font-medium tracking-tight leading-none
                   bg-black/75 text-white/90 border border-white/10"
      >
        {op.operator_name || `#${op.tag_id}`}
      </span>
    </div>
  )
}

function FloorPlanMap({
  rtls,
  sessionsByStation,
  operators,
  zoneByTag,
  selectedMachine,
  pinnedSet,
  onMachineClick,
}) {
  return (
    <div
      className="relative w-full h-full min-h-0 rounded-lg bg-black shadow-inner ring-1 ring-gray-200 dark:ring-slate-700"
      style={{ aspectRatio: `${FLOOR_PLAN.imageWidth} / ${FLOOR_PLAN.imageHeight}` }}
    >
      <img
        src={floorPlanImg}
        alt="Machine floor plan"
        className="absolute inset-0 w-full h-full object-fill select-none rounded-lg"
        draggable={false}
      />
      <div className="absolute inset-0 z-10 overflow-visible rounded-lg">
        {MACHINES.map(machine => {
          const parts = sessionsByStation[machine.station] ?? []
          const zoneOps = operatorsInMachineZone(rtls, machine)
          return (
            <MachineOverlay
              key={machine.id}
              machine={machine}
              partCount={parts.length}
              operatorCount={zoneOps.length}
              isActive={selectedMachine?.id === machine.id}
              isPinned={pinnedSet.has(machine.station)}
              onClick={e => onMachineClick(machine, e)}
            />
          )
        })}
        {operators.map((op, i) => {
          const pos = sewioToPercentClamped(op.x, op.y)
          return (
            <OperatorMarker
              key={op.tag_id}
              op={op}
              pos={pos}
              zone={zoneByTag.get(op.tag_id)}
              offMap={pos.offMap}
              colors={MARKER_COLORS[i % MARKER_COLORS.length]}
            />
          )
        })}
      </div>
    </div>
  )
}

export function LiveDashboard({ liveSessions = [], onEndSession }) {
  const { rtls, health, error, fetchedAt } = useRtlsLive()
  const [selectedMachine, setSelectedMachine] = useState(null)
  const [pinnedStations, setPinnedStations] = useState(loadPinnedStations)
  const [visibleMachines, setVisibleMachines] = useState(loadVisibleMachines)
  const [pinLimitMessage, setPinLimitMessage] = useState(null)

  useEffect(() => {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedStations))
  }, [pinnedStations])

  useEffect(() => {
    localStorage.setItem(VISIBLE_MACHINES_KEY, JSON.stringify(visibleMachines))
  }, [visibleMachines])

  useEffect(() => {
    if (!pinLimitMessage) return
    const t = setTimeout(() => setPinLimitMessage(null), 3500)
    return () => clearTimeout(t)
  }, [pinLimitMessage])

  const sessionsByStation = useMemo(() => {
    const grouped = {}
    for (const session of liveSessions) {
      const name = session.station_name ?? 'Unknown'
      if (!grouped[name]) grouped[name] = []
      grouped[name].push(session)
    }
    return grouped
  }, [liveSessions])

  const pinnedSet = useMemo(() => new Set(pinnedStations), [pinnedStations])
  const orderedPinnedStations = useMemo(
    () => sortByStationOrder(pinnedStations),
    [pinnedStations],
  )
  const pinLimitReached = pinnedStations.length >= MAX_PINNED

  const togglePinStation = useCallback((stationName) => {
    if (!PINNABLE_STATIONS.includes(stationName)) return

    setPinnedStations(prev => {
      if (prev.includes(stationName)) {
        return prev.filter(s => s !== stationName)
      }
      if (prev.length >= MAX_PINNED) {
        setPinLimitMessage(`You can pin up to ${MAX_PINNED} station queues at once.`)
        return prev
      }
      return sortByStationOrder([...prev, stationName])
    })
  }, [])

  const unpinStation = useCallback((stationName) => {
    setPinnedStations(prev => prev.filter(s => s !== stationName))
  }, [])

  const visibleMachineSet = useMemo(() => new Set(visibleMachines), [visibleMachines])
  const hasVisibleMachines = visibleMachines.length > 0

  const toggleMachineVisibility = useCallback((stationKey) => {
    setVisibleMachines(prev => {
      if (prev.includes(stationKey)) {
        return prev.filter(s => s !== stationKey)
      }
      return sortByStationOrder([...prev, stationKey])
    })
  }, [])

  const hideAllMachines = useCallback(() => {
    setVisibleMachines([])
  }, [])

  const handleMachineClick = useCallback((machine, e) => {
    if (e.shiftKey) {
      e.preventDefault()
      togglePinStation(machine.station)
      return
    }
    setSelectedMachine(machine)
  }, [togglePinStation])

  const zoneByTag = useMemo(() => {
    const lookup = new Map()
    for (const z of rtls?.zone_presence ?? []) {
      if (z.tag_id != null && z.status === 'in') lookup.set(z.tag_id, z)
    }
    return lookup
  }, [rtls])

  const operators = useMemo(() => {
    return (rtls?.positions ?? [])
      .filter(p => p.x != null && p.y != null)
      .sort((a, b) => (a.operator_name || '').localeCompare(b.operator_name || ''))
  }, [rtls])

  const rtlsEnabled = Boolean(
    health?.enabled ?? rtls?.enabled ?? health?.client_running ?? rtls?.connected,
  )
  const connected = Boolean(health?.websocket_connected ?? rtls?.connected)
  const updatedStr = fetchedAt
    ? fetchedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    : '—'

  const showConfigWarning = health != null && !health.enabled
  const showDisconnected = rtlsEnabled && !connected && operators.length === 0
  const showNoPositions = rtlsEnabled && connected && operators.length === 0
  const hasPinnedQueues = orderedPinnedStations.length > 0
  const allMachineStatuses = useMemo(
    () => getAllStationStatuses(PRODUCTION_LINE_STATIONS, PRODUCTION_LINE_ORDER, sessionsByStation, rtls),
    [sessionsByStation, rtls],
  )
  const visibleMachineStatuses = useMemo(
    () => allMachineStatuses.filter(s => visibleMachineSet.has(s.stationKey)),
    [allMachineStatuses, visibleMachineSet],
  )
  const machinesInUseCount = useMemo(
    () => allMachineStatuses.filter(s => s.inUse).length,
    [allMachineStatuses],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="animate-fade-in-scale rounded-xl p-4 flex items-center gap-3
                        bg-white border border-gray-200 shadow-sm
                        dark:bg-slate-800/60 dark:border-slate-700/60">
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center
                            ${connected ? 'bg-green-50 dark:bg-green-500/10' : 'bg-amber-50 dark:bg-amber-500/10'}`}>
            <Radio className={`w-4 h-4 ${connected ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`} />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">RTLS</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {!rtls && !health
                ? 'Loading…'
                : connected
                  ? 'Live'
                  : rtlsEnabled
                    ? 'Reconnecting…'
                    : 'Disabled'}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-slate-500 font-mono">Updated {updatedStr}</p>
          </div>
        </div>
        <div className="animate-fade-in-scale rounded-xl p-4 flex items-center gap-3
                        bg-white border border-gray-200 shadow-sm
                        dark:bg-slate-800/60 dark:border-slate-700/60">
          <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-blue-50 dark:bg-blue-500/10">
            <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">Tracked</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{operators.length}</p>
          </div>
        </div>
        <div className="animate-fade-in-scale rounded-xl p-4 flex items-center gap-3
                        bg-white border border-gray-200 shadow-sm
                        dark:bg-slate-800/60 dark:border-slate-700/60">
          <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-violet-50 dark:bg-violet-500/10">
            <MapIcon className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">Origin</p>
            <p className="text-sm font-mono text-gray-900 dark:text-slate-100">
              ({FLOOR_PLAN.originCoordX}, {FLOOR_PLAN.originCoordY}) m
            </p>
          </div>
        </div>
      </div>

      <Panel
        title="Floor Plan"
        subtitle="Live operator positions — pushed over WebSocket"
        icon={MapIcon}
        iconColor="text-violet-500 dark:text-violet-400"
      >
        {error && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {showConfigWarning && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300
                          bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20
                          rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            RTLS ingestion is disabled. Set ENABLE_LIVE_INGESTION=true in .env and restart the API.
          </div>
        )}

        {showDisconnected && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300
                          bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20
                          rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Sewio WebSocket is disconnected — waiting for operator positions. Check factory network access to 10.25.80.13.
          </div>
        )}

        {showNoPositions && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300
                          bg-slate-50 dark:bg-slate-500/10 border border-slate-200 dark:border-slate-500/20
                          rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Connected to Sewio but no operator positions yet.
          </div>
        )}

        {pinLimitMessage && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300
                          bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20
                          rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {pinLimitMessage}
          </div>
        )}

        <div className="px-4 sm:px-5 pt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Pin className="w-3 h-3" />
              Live queues:
            </span>
            {PINNABLE_STATIONS.map(name => {
              const pinned = pinnedSet.has(name)
              const count = sessionsByStation[name]?.length ?? 0
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => togglePinStation(name)}
                  disabled={!pinned && pinLimitReached}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                              border transition-colors
                    ${pinned
                      ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30 dark:hover:bg-blue-500/25'
                      : pinLimitReached
                        ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:border-violet-500/40'
                    }`}
                  title={pinned ? `Unpin ${name} queue` : `Pin ${name} queue`}
                >
                  {name}
                  {count > 0 && (
                    <span className={`tabular-nums ${pinned ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'}`}>
                      ({count})
                    </span>
                  )}
                  {pinned && <X className="w-3 h-3 opacity-70" />}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Factory className="w-3 h-3" />
              Machines:
            </span>
            {PRODUCTION_LINE_STATIONS.map(st => {
              const visible = visibleMachineSet.has(st.station)
              const status = allMachineStatuses.find(s => s.stationKey === st.station)
              const inUse = status?.inUse
              const light = status?.light
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => toggleMachineVisibility(st.station)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                              border transition-colors
                    ${visible
                      ? inUse
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 dark:hover:bg-emerald-500/25'
                        : light === 'amber'
                          ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700'
                      : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300 dark:bg-slate-900 dark:text-slate-500 dark:border-slate-700'
                    }`}
                  title={visible ? `Hide ${st.name}` : `Show ${st.name}`}
                >
                  {visible && light && light !== 'idle' && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0
                      ${light === 'green'
                        ? 'bg-green-500'
                        : light === 'amber'
                          ? 'bg-amber-500'
                          : 'bg-slate-400 dark:bg-slate-500'
                      }`}
                    />
                  )}
                  {st.name}
                  {visible && <X className="w-3 h-3 opacity-50" />}
                </button>
              )
            })}
            {hasVisibleMachines && (
              <button
                type="button"
                onClick={hideAllMachines}
                className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 px-1"
                title="Hide all machines"
              >
                Hide all
              </button>
            )}
            {!hasVisibleMachines && (
              <button
                type="button"
                onClick={() => setVisibleMachines(defaultVisibleMachines())}
                className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 px-1"
              >
                Show all
              </button>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div
            className={
              hasPinnedQueues
                ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)] gap-4 items-stretch'
                : ''
            }
          >
            <div className={hasPinnedQueues ? 'min-w-0 flex items-start' : ''}>
              <FloorPlanMap
                rtls={rtls}
                sessionsByStation={sessionsByStation}
                operators={operators}
                zoneByTag={zoneByTag}
                selectedMachine={selectedMachine}
                pinnedSet={pinnedSet}
                onMachineClick={handleMachineClick}
              />
            </div>

            {hasPinnedQueues && (
              <div className="flex flex-col gap-3 min-w-0 min-h-0">
                {orderedPinnedStations.map(stationName => (
                  <div key={stationName} className="flex-1 min-h-0 flex flex-col">
                    <LiveQueueTable
                      compact
                      stacked
                      stationName={stationName}
                      sessions={sessionsByStation[stationName] ?? []}
                      onEndSession={onEndSession}
                      onUnpin={() => unpinStation(stationName)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {hasVisibleMachines && (
            <div className="mt-4">
              <MachineStatusTable
                statuses={visibleMachineStatuses}
                onClose={hideAllMachines}
              />
            </div>
          )}

          <p className="mt-3 text-xs text-gray-500 dark:text-slate-400 text-center">
            {hasPinnedQueues
              ? 'Queues stack in line order (Gannomat above Insert) · Shift+click a machine to pin or unpin · Click for details'
              : 'Shift+click a machine on the map to show its live queue · Click for details'}
            {hasVisibleMachines
              ? ` · ${visibleMachineStatuses.length} machine${visibleMachineStatuses.length !== 1 ? 's' : ''} shown (${machinesInUseCount} in use)`
              : ''}
            {' · '}Origin at white rectangle top-left · {FLOOR_PLAN.scalePxPerM} px/m
          </p>
        </div>
      </Panel>

      {selectedMachine && (
        <StationDetailModal
          machine={selectedMachine}
          sessions={sessionsByStation[selectedMachine.station] ?? []}
          operatorsInZone={operatorsInMachineZone(rtls, selectedMachine)}
          onClose={() => setSelectedMachine(null)}
          isPinned={pinnedSet.has(selectedMachine.station)}
          pinLimitReached={pinLimitReached}
          onTogglePin={() => togglePinStation(selectedMachine.station)}
        />
      )}
    </div>
  )
}
