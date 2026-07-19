import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { AlertCircle, ChevronDown, Map as MapIcon, X } from 'lucide-react'
import { MachineOverlaySvg } from '../components/MachineOverlay'
import { AntennaMarkers } from '../components/AntennaEditor'
import { StationMarkers } from '../components/StationEditor'
import { PartChipLayer } from '../components/PartChipLayer'
import { MachineStatusTable } from '../components/MachineStatusPanel'
import { IbusOrdersSidebar } from '../components/IbusOrdersSidebar'
import { DwellTimer } from '../components/DwellTimer'
import { useRtlsLive } from '../hooks/useRtlsLive'
import { apiFetch, apiPost, apiDelete } from '../api'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { normalizeShapesMap, polygonCentroid } from '../utils/machinePolygons'
import { normalizeAntennaPlacements } from '../utils/antennaPlacements'
import { normalizeStationPlacements } from '../utils/stationPlacements'
import {
 ALL_STATIONS,
 PRODUCTION_LINE_ORDER,
 PRODUCTION_LINE_STATIONS,
 applyMachineShapes,
 machinesWithPolygons,
 operatorsByStation,
} from '../utils/machineRegions'
import { getAllStationStatuses, sessionsForStation } from '../utils/stationStatus'
import { ibusOrderKey } from '../utils/ibusOrder'
import floorPlanImg from '../assets/floor_plan.png'

const MAP_OPEN_KEY = 'liveDashboard.mapOpen'

function sessionDwellSeconds(session) {
 const ms = session.entry_epoch_ms
  ?? (session.entry_time ? new Date(session.entry_time).getTime() : NaN)
 if (!Number.isFinite(ms)) return null
 return Math.max(0, (Date.now() - ms) / 1000)
}

function OperatorMarker({ op, zoneName, pos, stackIndex = 0 }) {
 const title = [op.operator_name || `Tag ${op.tag_id}`, zoneName].filter(Boolean).join(' · ')
 const offsetPx = stackIndex * 10
 return (
  <div
   data-floor-marker
   className="absolute z-20 pointer-events-auto"
   style={{
    left: pos.left,
    top: pos.top,
    transform: `translate(calc(-50% + ${offsetPx}px), -50%)`,
   }}
   title={title}
  >
   <span className="relative flex items-center justify-center w-2 h-2 rounded-full
                    ring-2 ring-white/90 bg-white">
   </span>
   <span className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap
 px-1 py-px rounded text-[7px] font-medium leading-none
          bg-black/75 text-white/90">
    {op.operator_name || `#${op.tag_id}`}
   </span>
  </div>
 )
}

function FloorPlanMap({
 liveSessions,
 operators,
 machines,
 antennaPlacements,
 showAntennaMarkers,
 stations,
 stationPlacements,
 showStationMarkers,
 mapRef,
 getDelayLevel,
 onPartClick,
 onStationClick,
}) {
 return (
  <div
   ref={mapRef}
   className="relative w-full min-w-0 rounded-[6px] bg-black ring-1 ring-[#2a2a32]"
   style={{ aspectRatio: `${FLOOR_PLAN.imageWidth} / ${FLOOR_PLAN.imageHeight}` }}
  >
   <img
    src={floorPlanImg}
    alt="Machine floor plan"
    className="absolute inset-0 w-full h-full object-fill select-none rounded-[6px]"
    draggable={false}
   />
   <div className="absolute inset-0 z-10 overflow-visible rounded-[6px]">
    <MachineOverlaySvg className="z-10 pointer-events-none">
     <AntennaMarkers
      placements={antennaPlacements}
      antennas={[]}
      showMarkers={showAntennaMarkers}
     />
     <StationMarkers
      placements={stationPlacements}
      stations={stations}
      showMarkers={showStationMarkers}
      onStationClick={onStationClick}
     />
    </MachineOverlaySvg>
    <PartChipLayer
     sessions={liveSessions}
     placements={antennaPlacements}
     machines={machines}
     getDelayLevel={getDelayLevel}
     onPartClick={onPartClick}
    />
    {operators.map((entry) => (
     <OperatorMarker
      key={entry.op.tag_id}
      op={entry.op}
      pos={entry.pos}
      zoneName={entry.zoneName}
      stackIndex={entry.stackIndex}
     />
    ))}
   </div>
  </div>
 )
}

const MemoFloorPlanMap = memo(FloorPlanMap)

function StationDetailPanel({ stationKey, stationName, status, sessions, onClose }) {
 if (!stationKey) return null
 return (
  <div className="bb-panel">
   <div className="bb-panel-header">
    <div>
     <h3 className="bb-title">{stationName || stationKey}</h3>
     <p className="bb-subtitle">
      {status?.hasPart && !status?.hasOperator
       ? 'Part present — no operator'
       : status?.inUse
        ? 'In use'
        : 'Idle'}
     </p>
    </div>
    <button type="button" onClick={onClose} className="bb-btn-ghost p-1" aria-label="Close">
     <X className="w-4 h-4" />
    </button>
   </div>
   <div className="px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border-b border-[#2a2a32]">
    <div>
     <p className="bb-kpi-label">Operator</p>
     <p className="text-sm font-medium mt-0.5">{status?.operatorName ?? '—'}</p>
    </div>
    <div>
     <p className="bb-kpi-label">Parts in queue</p>
     <p className="text-sm font-medium tabular-nums mt-0.5">{sessions.length}</p>
    </div>
    <div>
     <p className="bb-kpi-label">Part dwell</p>
     <p className="text-sm font-mono mt-0.5">
      {status?.partEntryTime || status?.partEntryEpochMs != null ? (
       <DwellTimer
        entranceTime={status.partEntryTime}
        entranceEpochMs={status.partEntryEpochMs}
        exitTime={null}
        dwellSeconds={null}
       />
      ) : '—'}
     </p>
    </div>
    <div>
     <p className="bb-kpi-label">Operator dwell</p>
     <p className="text-sm font-mono mt-0.5">
      {status?.operatorEnteredAt ? (
       <DwellTimer entranceTime={status.operatorEnteredAt} exitTime={null} dwellSeconds={null} />
      ) : '—'}
     </p>
    </div>
   </div>
   {sessions.length === 0 ? (
    <p className="bb-empty py-4">No parts currently at this station</p>
   ) : (
    <div className="overflow-x-auto">
     <table className="bb-table">
      <thead className="bb-table-head">
       <tr>
        <th>Part</th>
        <th>Work order</th>
        <th className="text-right">Dwell</th>
       </tr>
      </thead>
      <tbody>
       {sessions.map(s => (
        <tr key={s.id ?? s.session_id} className="bb-table-row">
         <td className="font-mono text-xs">
          {s.part_number || s.part_name || s.epc || '—'}
         </td>
         <td className="font-mono text-xs text-[#8b939e]">
          {s.work_order || s.ibus_number || ibusOrderKey(s) || '—'}
         </td>
         <td className="text-right font-mono text-xs">
          <DwellTimer
           entranceTime={s.entry_time}
           entranceEpochMs={s.entry_epoch_ms}
           exitTime={null}
           dwellSeconds={null}
          />
         </td>
        </tr>
       ))}
      </tbody>
     </table>
    </div>
   )}
  </div>
 )
}

export function LiveDashboard({ liveSessions = [], tick = 0 }) {
 const { rtls, health, error, refresh } = useRtlsLive()

 const [shapesMap, setShapesMap] = useState({})
 const [antennaPlacements, setAntennaPlacements] = useState({})
 const [stationPlacements, setStationPlacements] = useState({})
 const [openIbusJourneys, setOpenIbusJourneys] = useState([])
 const [specsByStation, setSpecsByStation] = useState({})
 const [showSystemStatus, setShowSystemStatus] = useState(false)
 const [demoBusy, setDemoBusy] = useState(false)
 const [statusMessage, setStatusMessage] = useState(null)
 const [selectedOrderKey, setSelectedOrderKey] = useState(null)
 const [selectedStationKey, setSelectedStationKey] = useState(null)
 const [mapOpen, setMapOpen] = useState(() => {
  try {
   return localStorage.getItem(MAP_OPEN_KEY) === 'true'
  } catch {
   return false
  }
 })
 const mapRef = useRef(null)

 const loadOpenIbus = useCallback(() => {
  apiFetch('/api/ibus?status=open&limit=80')
   .then(rows => { if (Array.isArray(rows)) setOpenIbusJourneys(rows) })
   .catch(() => {})
 }, [])

 useEffect(() => { loadOpenIbus() }, [tick, loadOpenIbus])

 useEffect(() => {
  let cancelled = false
  Promise.all([
   apiFetch('/api/machine-shapes').catch(() => ({})),
   apiFetch('/api/antenna-placements').catch(() => ({})),
   apiFetch('/api/station-placements').catch(() => ({})),
   apiFetch('/api/station-specifications').catch(() => null),
  ]).then(([shapes, placements, stationPins, specs]) => {
   if (cancelled) return
   setShapesMap(normalizeShapesMap(shapes))
   setAntennaPlacements(normalizeAntennaPlacements(placements))
   setStationPlacements(normalizeStationPlacements(stationPins))
   const byName = {}
   for (const row of specs?.specifications ?? []) {
    if (row.station_name) byName[row.station_name] = row
    // Tennoner / Tenoner alias
    if (row.station_name === 'Tennoner') byName.Tenoner = row
    if (row.station_name === 'Tenoner') byName.Tennoner = row
   }
   setSpecsByStation(byName)
  })
  return () => { cancelled = true }
 }, [])

 useEffect(() => {
  try { localStorage.setItem(MAP_OPEN_KEY, String(mapOpen)) } catch { /* ignore */ }
 }, [mapOpen])

 useEffect(() => {
  if (!statusMessage) return
  const t = setTimeout(() => setStatusMessage(null), 4000)
  return () => clearTimeout(t)
 }, [statusMessage])

 const stationsWithShapes = useMemo(
  () => applyMachineShapes(ALL_STATIONS, shapesMap),
  [shapesMap],
 )
 const mapMachines = useMemo(
  () => machinesWithPolygons(stationsWithShapes),
  [stationsWithShapes],
 )

 const sessionsByStation = useMemo(() => {
  const grouped = {}
  for (const session of liveSessions) {
   const name = session.station_name ?? 'Unknown'
   if (!grouped[name]) grouped[name] = []
   grouped[name].push(session)
  }
  return grouped
 }, [liveSessions])

 const operatorsByStationMap = useMemo(
  () => operatorsByStation(rtls, stationsWithShapes),
  [rtls, stationsWithShapes],
 )

 const operators = useMemo(() => {
  const machinesByStation = new Map(stationsWithShapes.map(m => [m.station, m]))
  const stationMeta = new Map(PRODUCTION_LINE_STATIONS.map(s => [s.station, s]))
  const markers = []
  for (const [station, ops] of operatorsByStationMap) {
   // Operator dots only at stations that currently have a part
   const stSessions = sessionsByStation[station]
    ?? sessionsByStation[station === 'Tennoner' ? 'Tenoner' : station === 'Tenoner' ? 'Tennoner' : '']
    ?? []
   const hasPart = stSessions.some(s => s.status === 'open' || s.status === 'exit_only')
   if (!hasPart) continue

   const pin = stationPlacements[station]
   const machine = machinesByStation.get(station)
   let x = null
   let y = null
   if (pin && Number.isFinite(pin.x) && Number.isFinite(pin.y)) {
    x = pin.x
    y = pin.y
   } else if (machine?.polygon?.length >= 3) {
    const c = polygonCentroid(machine.polygon)
    x = c.x
    y = c.y
   }
   if (x == null || y == null) continue
   const label = stationMeta.get(station)?.name || machine?.name || station
   const pos = {
    left: `${(x / FLOOR_PLAN.imageWidth) * 100}%`,
    top: `${(y / FLOOR_PLAN.imageHeight) * 100}%`,
   }
   ops.forEach((op, stackIndex) => {
    markers.push({
     op,
     pos,
     zoneName: op.zone_name || label,
     stackIndex,
    })
   })
  }
  return markers.sort((a, b) =>
   (a.op.operator_name || '').localeCompare(b.op.operator_name || ''),
  )
 }, [operatorsByStationMap, stationsWithShapes, stationPlacements, sessionsByStation])

 const hasZoneOperators = useMemo(() => {
  for (const ops of operatorsByStationMap.values()) {
   if (ops.length > 0) return true
  }
  return false
 }, [operatorsByStationMap])

 const rtlsEnabled = Boolean(
  health?.enabled ?? rtls?.enabled ?? health?.client_running ?? rtls?.connected,
 )
 const connected = Boolean(health?.websocket_connected ?? rtls?.connected)
 const showConfigWarning = health != null && !health.enabled
 const showDisconnected = rtlsEnabled && !connected && !hasZoneOperators
 const showNoPositions = rtlsEnabled && connected && !hasZoneOperators

 const allMachineStatuses = useMemo(
  () => getAllStationStatuses(
   PRODUCTION_LINE_STATIONS,
   PRODUCTION_LINE_ORDER,
   sessionsByStation,
   rtls,
   operatorsByStationMap,
  ),
  [sessionsByStation, rtls, operatorsByStationMap],
 )

 const getDelayLevel = useCallback((session) => {
  const dwell = sessionDwellSeconds(session)
  if (dwell == null) return 'ok'
  const spec = specsByStation[session.station_name]
   ?? specsByStation[session.station_name === 'Tennoner' ? 'Tenoner' : '']
  const maxSec = spec?.max_dwell_seconds
  const targetSec = spec?.target_part_dwell_seconds
  if (maxSec != null && dwell >= maxSec) return 'critical'
  if (targetSec != null && dwell >= targetSec) return 'warn'
  return 'ok'
 }, [specsByStation])

 const delayedSessionCount = useMemo(
  () => liveSessions.filter(s => {
   const level = getDelayLevel(s)
   return level === 'warn' || level === 'critical'
  }).length,
  [liveSessions, getDelayLevel],
 )

 const stationsDelayed = useMemo(() => {
  return allMachineStatuses.filter(st => {
   const station = PRODUCTION_LINE_STATIONS.find(s => s.station === st.stationKey)
   if (!station) return st.light === 'amber'
   const sessions = sessionsForStation(sessionsByStation, station)
    .filter(s => s.status === 'open' || s.status === 'exit_only')
   return sessions.some(s => {
    const level = getDelayLevel(s)
    return level === 'warn' || level === 'critical'
   }) || st.light === 'amber'
  }).length
 }, [allMachineStatuses, sessionsByStation, getDelayLevel])

 const unstaffedStations = useMemo(
  () => allMachineStatuses.filter(s => s.hasPart && !s.hasOperator).length,
  [allMachineStatuses],
 )

 const ordersBehind = useMemo(() => {
  return openIbusJourneys.filter(j => {
   if (j.actual_vs_estimated_seconds != null && j.actual_vs_estimated_seconds > 0) return true
   // Any open part over dwell target
   for (const p of j.parts ?? []) {
    const openM = [...(p.machines ?? [])].reverse().find(m => m.status === 'open' || m.status === 'Open')
    if (!openM) continue
    const level = getDelayLevel({
     ...openM,
     station_name: openM.station_name,
     entry_time: openM.entry_time,
     entry_epoch_ms: openM.entry_epoch_ms,
    })
    if (level === 'warn' || level === 'critical') return true
   }
   return false
  }).length
 }, [openIbusJourneys, getDelayLevel])

 const partsInProcess = liveSessions.length
 const activePartsOnMap = useMemo(
  () => liveSessions.filter(s => s.status === 'open' || s.status === 'exit_only').length,
  [liveSessions],
 )

 const loadDemoOperators = useCallback(async () => {
  setDemoBusy(true)
  try {
   await apiPost('/api/rtls/demo')
   await refresh()
   setStatusMessage('Demo operators loaded')
  } catch {
   setStatusMessage('Could not load demo operators — restart the API first')
  } finally {
   setDemoBusy(false)
  }
 }, [refresh])

 const clearDemoOperators = useCallback(async () => {
  setDemoBusy(true)
  try {
   await apiDelete('/api/rtls/demo')
   await refresh()
   setStatusMessage('Demo operators cleared')
  } catch {
   setStatusMessage('Could not clear demo operators')
  } finally {
   setDemoBusy(false)
  }
 }, [refresh])

 const handlePartClick = useCallback((session) => {
  const key = ibusOrderKey(session) || session.ibus_number || session.work_order
  if (key) setSelectedOrderKey(key)
 }, [])

 const handleStationSelect = useCallback((stationKey) => {
  setSelectedStationKey(prev => (prev === stationKey ? null : stationKey))
 }, [])

 const selectedStationMeta = useMemo(() => {
  if (!selectedStationKey) return null
  const status = allMachineStatuses.find(s => s.stationKey === selectedStationKey)
  const station = PRODUCTION_LINE_STATIONS.find(s => s.station === selectedStationKey)
  const sessions = station
   ? sessionsForStation(sessionsByStation, station).filter(s => s.status === 'open' || s.status === 'exit_only')
   : (sessionsByStation[selectedStationKey] ?? [])
  return {
   stationKey: selectedStationKey,
   stationName: status?.stationName || station?.name || selectedStationKey,
   status,
   sessions,
  }
 }, [selectedStationKey, allMachineStatuses, sessionsByStation])

 const alerts = useMemo(() => {
  const list = []
  if (ordersBehind > 0) list.push(`${ordersBehind} order${ordersBehind === 1 ? '' : 's'} behind target`)
  if (stationsDelayed > 0) list.push(`${stationsDelayed} station${stationsDelayed === 1 ? '' : 's'} delayed`)
  if (unstaffedStations > 0) list.push(`${unstaffedStations} unstaffed station${unstaffedStations === 1 ? '' : 's'}`)
  if (delayedSessionCount > 0) list.push(`${delayedSessionCount} part${delayedSessionCount === 1 ? '' : 's'} over dwell target`)
  return list
 }, [ordersBehind, stationsDelayed, unstaffedStations, delayedSessionCount])

 return (
  <div className="space-y-3">
   {/* Shift status */}
   <div className="bb-kpi-strip">
    <div>
     <p className="bb-kpi-label">Orders behind</p>
     <p className={`bb-kpi-value ${ordersBehind > 0 ? 'text-[#fbbf24]' : ''}`}>{ordersBehind}</p>
    </div>
    <div>
     <p className="bb-kpi-label">Parts in process</p>
     <p className="bb-kpi-value">{partsInProcess}</p>
    </div>
    <div>
     <p className="bb-kpi-label">Stations delayed</p>
     <p className={`bb-kpi-value ${stationsDelayed > 0 ? 'text-[#fbbf24]' : ''}`}>{stationsDelayed}</p>
    </div>
    <div>
     <p className="bb-kpi-label">Unstaffed stations</p>
     <p className={`bb-kpi-value ${unstaffedStations > 0 ? 'text-[#fbbf24]' : ''}`}>{unstaffedStations}</p>
    </div>
   </div>

   {(alerts.length > 0 || showConfigWarning || showDisconnected || error) && (
    <div className="flex flex-wrap items-center gap-2 text-xs">
     {alerts.map(a => (
      <span key={a} className="bb-badge-warn">{a}</span>
     ))}
     {(showConfigWarning || showDisconnected || error) && (
      <button
       type="button"
       onClick={() => setShowSystemStatus(v => !v)}
       className="bb-btn-outline text-[#8b939e]"
      >
       <AlertCircle className="w-3 h-3" />
       System
      </button>
     )}
    </div>
   )}

   {showSystemStatus && (showConfigWarning || showDisconnected || showNoPositions || error) && (
    <div className="bb-panel px-3 py-2 space-y-1.5 text-xs">
     <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8b939e]">System status</p>
     {error && <p className="text-[#f87171]">{error}</p>}
     {showConfigWarning && (
      <p className="text-[#fbbf24]">
       RTLS ingestion is disabled. Set ENABLE_LIVE_INGESTION=true in .env and restart the API.
      </p>
     )}
     {showDisconnected && (
      <div className="flex flex-wrap items-center gap-2 text-[#fbbf24]">
       <span className="flex-1">Sewio WebSocket disconnected.</span>
       <button type="button" disabled={demoBusy} onClick={loadDemoOperators} className="bb-btn-outline">
        {demoBusy ? 'Loading…' : 'Load demo operators'}
       </button>
      </div>
     )}
     {showNoPositions && (
      <div className="flex flex-wrap items-center gap-2 text-[#8b939e]">
       <span className="flex-1">Connected — no operators in a mapped zone yet.</span>
       <button type="button" disabled={demoBusy} onClick={loadDemoOperators} className="bb-btn-outline">
        {demoBusy ? 'Loading…' : 'Load demo operators'}
       </button>
      </div>
     )}
     {operators.length > 0 && (
      <button type="button" disabled={demoBusy} onClick={clearDemoOperators} className="bb-btn-ghost text-xs">
       Clear demo operators
      </button>
     )}
    </div>
   )}

   {statusMessage && (
    <p className="text-xs text-[#8b939e]">{statusMessage}</p>
   )}

   {/* Production focus */}
   <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch min-h-[22rem]">
    <div className="min-w-0 min-h-[18rem] lg:min-h-0 h-full overflow-hidden">
     <IbusOrdersSidebar
      journeys={openIbusJourneys}
      selectedKey={selectedOrderKey}
      onSelectedKeyChange={setSelectedOrderKey}
     />
    </div>
    <div className="min-w-0 min-h-[18rem] lg:min-h-0 h-full overflow-hidden">
     <MachineStatusTable
      statuses={allMachineStatuses}
      selectedStationKey={selectedStationKey}
      onStationClick={(row) => handleStationSelect(row.stationKey)}
     />
    </div>
   </div>

   {selectedStationMeta && (
    <StationDetailPanel
     stationKey={selectedStationMeta.stationKey}
     stationName={selectedStationMeta.stationName}
     status={selectedStationMeta.status}
     sessions={selectedStationMeta.sessions}
     onClose={() => setSelectedStationKey(null)}
    />
   )}

   {/* Collapsible live map — secondary */}
   <div className="bb-panel">
    <button
     type="button"
     onClick={() => setMapOpen(v => !v)}
     className="w-full bb-panel-header hover:bg-white/[0.02] transition-colors text-left"
    >
     <div className="min-w-0 flex items-center gap-2">
      <MapIcon className="w-10 h-10 text-[#8b939e]" />
      <div>
       <h2 className="bb-title">Live floor map</h2>
       <p className="bb-subtitle">
        {activePartsOnMap} active part{activePartsOnMap === 1 ? '' : 's'}
        {delayedSessionCount > 0 ? ` · ${delayedSessionCount} delayed` : ''}
        {operators.length > 0 ? ` · ${operators.length} operator${operators.length === 1 ? '' : 's'} at stations` : ''}
       </p>
      </div>
     </div>
     <ChevronDown
      className={`w-4 h-4 text-[#8b939e] transition-transform ${mapOpen ? '' : '-rotate-90'}`}
     />
    </button>

    {mapOpen && (
     <div className="p-2 pt-0 space-y-1.5">
      <div className="w-full">
       <MemoFloorPlanMap
        liveSessions={liveSessions.filter(s => s.status === 'open' || s.status === 'exit_only')}
        operators={operators}
        machines={mapMachines}
        antennaPlacements={antennaPlacements}
        showAntennaMarkers={false}
        stations={PRODUCTION_LINE_STATIONS}
        stationPlacements={stationPlacements}
        showStationMarkers
        mapRef={mapRef}
        getDelayLevel={getDelayLevel}
        onPartClick={handlePartClick}
        onStationClick={(id) => handleStationSelect(id)}
       />
      </div>
      <p className="text-[11px] text-[#8b939e] px-1">
       Amber/red = over dwell target · Click a part for its work order · Click a station pin for queue detail
       {' · '}Floor plan pins are configured in Settings
      </p>
     </div>
    )}
   </div>
  </div>
 )
}
