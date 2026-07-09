import { useMemo, useState } from 'react'
import { Map as MapIcon, Radio, Users, AlertCircle } from 'lucide-react'
import { Panel } from '../components/Panel'
import { LiveQueueTable } from '../components/LiveQueueTable'
import { MachineOverlay } from '../components/MachineOverlay'
import { StationDetailModal } from '../components/StationDetailModal'
import { useRtlsLive } from '../hooks/useRtlsLive'
import { FLOOR_PLAN, sewioToPercentClamped } from '../utils/floorPlanCoords'
import { MACHINES, operatorsInMachineZone } from '../utils/machineRegions'
import floorPlanImg from '../assets/floor_plan.png'

const STATION_ORDER = ['Gannomat', 'Insert Station']

const MARKER_COLORS = [
  { dot: 'bg-blue-500', ring: 'ring-blue-300', glow: 'shadow-blue-400/60' },
  { dot: 'bg-emerald-500', ring: 'ring-emerald-300', glow: 'shadow-emerald-400/60' },
  { dot: 'bg-violet-500', ring: 'ring-violet-300', glow: 'shadow-violet-400/60' },
  { dot: 'bg-amber-500', ring: 'ring-amber-300', glow: 'shadow-amber-400/60' },
  { dot: 'bg-rose-500', ring: 'ring-rose-300', glow: 'shadow-rose-400/60' },
  { dot: 'bg-cyan-500', ring: 'ring-cyan-300', glow: 'shadow-cyan-400/60' },
]

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

export function LiveDashboard({ liveSessions = [], onEndSession }) {
  const { rtls, health, error, fetchedAt } = useRtlsLive()
  const [selectedMachine, setSelectedMachine] = useState(null)

  const sessionsByStation = useMemo(() => {
    const grouped = {}
    for (const session of liveSessions) {
      const name = session.station_name ?? 'Unknown'
      if (!grouped[name]) grouped[name] = []
      grouped[name].push(session)
    }
    return grouped
  }, [liveSessions])

  const stationNames = useMemo(() => {
    const names = new Set(STATION_ORDER)
    for (const name of Object.keys(sessionsByStation)) names.add(name)
    return [...names]
  }, [sessionsByStation])

  const zoneByTag = useMemo(() => {
    const lookup = new Map()
    for (const z of rtls?.zone_presence ?? []) {
      if (z.tag_id != null && z.status === 'in') lookup.set(z.tag_id, z)
    }
    return lookup
  }, [rtls])

  // Trust the API — backend already filters stale Sewio snapshots.
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

        <div className="p-4 sm:p-5">
          <div
            className="relative w-full rounded-lg bg-black shadow-inner ring-1 ring-gray-200 dark:ring-slate-700"
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
                    onClick={() => setSelectedMachine(machine)}
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

          <p className="mt-3 text-xs text-gray-500 dark:text-slate-400 text-center">
            Click a machine for parts &amp; operators · Origin at white rectangle top-left · {FLOOR_PLAN.scalePxPerM} px/m
          </p>
        </div>
      </Panel>

      {stationNames.map(stationName => (
        <LiveQueueTable
          key={stationName}
          stationName={stationName}
          sessions={sessionsByStation[stationName] ?? []}
          onEndSession={onEndSession}
        />
      ))}

      {selectedMachine && (
        <StationDetailModal
          machine={selectedMachine}
          sessions={sessionsByStation[selectedMachine.station] ?? []}
          operatorsInZone={operatorsInMachineZone(rtls, selectedMachine)}
          onClose={() => setSelectedMachine(null)}
        />
      )}

      {operators.length > 0 && (
        <Panel title="Operators" subtitle="Current positions" icon={Users}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400
                               border-b border-gray-200 dark:border-slate-700">
                  <th className="px-5 py-3 font-semibold">Name</th>
                  <th className="px-5 py-3 font-semibold">X (m)</th>
                  <th className="px-5 py-3 font-semibold">Y (m)</th>
                  <th className="px-5 py-3 font-semibold">Zone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                {operators.map(op => {
                  const zone = zoneByTag.get(op.tag_id)
                  return (
                    <tr key={op.tag_id} className="text-gray-800 dark:text-slate-200">
                      <td className="px-5 py-2.5 font-medium">{op.operator_name || `Tag ${op.tag_id}`}</td>
                      <td className="px-5 py-2.5 font-mono text-gray-600 dark:text-slate-400">
                        {Number(op.x).toFixed(2)}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-gray-600 dark:text-slate-400">
                        {Number(op.y).toFixed(2)}
                      </td>
                      <td className="px-5 py-2.5 text-gray-600 dark:text-slate-400">
                        {zone?.zone_name || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}
