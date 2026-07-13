import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapIcon, AlertCircle, Pin, Factory, Pencil, MapPin, Eye, EyeOff } from 'lucide-react'
import { Panel } from '../components/Panel'
import { LiveQueueTable } from '../components/LiveQueueTable'
import { MachineOverlay, MachineOverlaySvg } from '../components/MachineOverlay'
import { MachineShapeToolbar, ShapeDraftLayer } from '../components/MachineShapeEditor'
import { AntennaPlaceToolbar, AntennaPlaceLayer, AntennaMarkers } from '../components/AntennaEditor'
import { PartChipLayer } from '../components/PartChipLayer'
import { MachineStatusTable } from '../components/MachineStatusPanel'
import { StationDetailModal } from '../components/StationDetailModal'
import { IbusOrdersSidebar } from '../components/IbusOrdersSidebar'
import { useRtlsLive } from '../hooks/useRtlsLive'
import { apiFetch, apiPut } from '../api'
import { FLOOR_PLAN, sewioToPercentClamped } from '../utils/floorPlanCoords'
import { normalizeShapesMap } from '../utils/machinePolygons'
import {
  normalizeAntennaPlacements,
  placementsToPayload,
} from '../utils/antennaPlacements'
import {
  ALL_STATIONS,
  PINNABLE_STATIONS,
  PRODUCTION_LINE_ORDER,
  PRODUCTION_LINE_STATIONS,
  applyMachineShapes,
  machinesWithPolygons,
  operatorsInMachineZone,
} from '../utils/machineRegions'
import { getAllStationStatuses } from '../utils/stationStatus'
import floorPlanImg from '../assets/floor_plan.png'

const MAX_PINNED = PINNABLE_STATIONS.length
const PINNED_STORAGE_KEY = 'liveDashboard.pinnedStations'
const VISIBLE_MACHINES_KEY = 'liveDashboard.visibleMachines'
const SHOW_ANTENNAS_KEY = 'liveDashboard.showAntennaMarkers'

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

function shapesToPayload(shapesMap) {
  const out = {}
  for (const [station, shape] of Object.entries(shapesMap)) {
    if (shape?.polygon?.length >= 3) {
      out[station] = {
        polygon: shape.polygon.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
      }
    }
  }
  return out
}

function OperatorMarker({ op, colors, zone, offMap, pos, editMode = false }) {
  const title = [
    op.operator_name || `Tag ${op.tag_id}`,
    `x=${Number(op.x).toFixed(1)} y=${Number(op.y).toFixed(1)}`,
    zone?.zone_name,
    offMap ? '(off map — clamped to edge)' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      data-floor-marker
      className={`absolute z-20 ${editMode ? 'pointer-events-none opacity-80' : 'pointer-events-auto'}`}
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
  liveSessions,
  operators,
  zoneByTag,
  selectedMachine,
  pinnedSet,
  onMachineClick,
  onPartClick,
  machines,
  stationsForPresence,
  editMode,
  editStation,
  draftPoints,
  onDraftChange,
  onCloseShape,
  antennaMode,
  antennas,
  antennaPlacements,
  selectedAntennaId,
  onPlaceAntenna,
  onSelectAntenna,
  onRemoveAntenna,
  showAntennaMarkers,
  mapRef,
}) {
  const mapBusy = editMode || antennaMode

  return (
    <div
      ref={mapRef}
      className="relative w-full max-w-5xl mx-auto h-full min-h-0 rounded-lg bg-black shadow-inner ring-1 ring-gray-200 dark:ring-slate-700"
      style={{ aspectRatio: `${FLOOR_PLAN.imageWidth} / ${FLOOR_PLAN.imageHeight}` }}
    >
      <img
        src={floorPlanImg}
        alt="Machine floor plan"
        className="absolute inset-0 w-full h-full object-fill select-none rounded-lg"
        draggable={false}
      />
      <div className="absolute inset-0 z-10 overflow-visible rounded-lg">
        <MachineOverlaySvg
          className={
            antennaMode || editMode
              ? 'z-20 pointer-events-none'
              : 'z-10'
          }
        >
          {/* Keep regions visible while placing antennas (locked / non-interactive) */}
          {machines.map(machine => {
            const parts = sessionsByStation[machine.station] ?? []
            if (editMode && editStation === machine.station && draftPoints.length > 0) return null
            return (
              <MachineOverlay
                key={machine.id}
                machine={machine}
                partCount={parts.length}
                operatorCount={operatorsInMachineZone(rtls, machine, stationsForPresence).length}
                isActive={selectedMachine?.id === machine.id}
                isPinned={pinnedSet.has(machine.station)}
                editMode={editMode || antennaMode}
                isEditTarget={editMode && editStation === machine.station}
                showPartBadge={false}
                onClick={e => onMachineClick(machine, e)}
              />
            )
          })}
          {!antennaMode && !editMode && (
            <AntennaMarkers
              placements={antennaPlacements}
              antennas={antennas}
              showMarkers={showAntennaMarkers}
            />
          )}
        </MachineOverlaySvg>
        {!antennaMode && !editMode && (
          <PartChipLayer
            sessions={liveSessions}
            placements={antennaPlacements}
            machines={machines}
            onPartClick={onPartClick}
          />
        )}
        {editMode && (
          <ShapeDraftLayer
            draftPoints={draftPoints}
            onDraftChange={onDraftChange}
            onCloseShape={onCloseShape}
            mapRef={mapRef}
          />
        )}
        {antennaMode && (
          <AntennaPlaceLayer
            mapRef={mapRef}
            selectedId={selectedAntennaId}
            placements={antennaPlacements}
            antennas={antennas}
            onPlace={onPlaceAntenna}
            onSelect={onSelectAntenna}
            onRemove={onRemoveAntenna}
          />
        )}
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
              editMode={mapBusy}
            />
          )
        })}
      </div>
    </div>
  )
}

export function LiveDashboard({ liveSessions = [], onEndSession, tick = 0 }) {
  const { rtls, health, error, fetchedAt } = useRtlsLive()
  const [selectedMachine, setSelectedMachine] = useState(null)
  const [pinnedStations, setPinnedStations] = useState(loadPinnedStations)
  const [visibleMachines, setVisibleMachines] = useState(loadVisibleMachines)
  const [pinLimitMessage, setPinLimitMessage] = useState(null)

  const [shapesMap, setShapesMap] = useState({})
  const [shapesLoaded, setShapesLoaded] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editStation, setEditStation] = useState(PRODUCTION_LINE_STATIONS[0]?.station ?? 'Gannomat')
  const [draftPoints, setDraftPoints] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shapeMessage, setShapeMessage] = useState(null)
  const [antennas, setAntennas] = useState([])
  const [antennaPlacements, setAntennaPlacements] = useState({})
  const [antennaMode, setAntennaMode] = useState(false)
  const [selectedAntennaId, setSelectedAntennaId] = useState(null)
  const [antennaDirty, setAntennaDirty] = useState(false)
  const [antennaSaving, setAntennaSaving] = useState(false)
  const [showAntennaMarkers, setShowAntennaMarkers] = useState(() => {
    try {
      const raw = localStorage.getItem(SHOW_ANTENNAS_KEY)
      return raw == null ? true : raw === 'true'
    } catch {
      return true
    }
  })
  const mapRef = useRef(null)
  const shapesBaseline = useRef({})
  const antennaBaseline = useRef({})
  const [openIbusJourneys, setOpenIbusJourneys] = useState([])

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/ibus?status=open&limit=80')
      .then(rows => {
        if (!cancelled && Array.isArray(rows)) setOpenIbusJourneys(rows)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tick])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/api/machine-shapes').catch(() => ({})),
      apiFetch('/api/antenna-placements').catch(() => ({})),
      apiFetch('/api/antennas').catch(() => []),
    ]).then(([shapes, placements, ants]) => {
      if (cancelled) return
      const normalizedShapes = normalizeShapesMap(shapes)
      setShapesMap(normalizedShapes)
      shapesBaseline.current = normalizedShapes
      const normalizedPlacements = normalizeAntennaPlacements(placements)
      setAntennaPlacements(normalizedPlacements)
      antennaBaseline.current = normalizedPlacements
      const list = Array.isArray(ants) ? ants : []
      setAntennas(list)
      if (list.length > 0) {
        setSelectedAntennaId(String(list[0].antenna_id))
      }
      setShapesLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    localStorage.setItem(SHOW_ANTENNAS_KEY, String(showAntennaMarkers))
  }, [showAntennaMarkers])

  const stationsWithShapes = useMemo(
    () => applyMachineShapes(ALL_STATIONS, shapesMap),
    [shapesMap],
  )
  const productionStations = useMemo(
    () => applyMachineShapes(PRODUCTION_LINE_STATIONS, shapesMap),
    [shapesMap],
  )
  const mapMachines = useMemo(
    () => machinesWithPolygons(stationsWithShapes),
    [stationsWithShapes],
  )

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

  useEffect(() => {
    if (!shapeMessage) return
    const t = setTimeout(() => setShapeMessage(null), 4000)
    return () => clearTimeout(t)
  }, [shapeMessage])

  // Start a fresh draft when opening draw mode or switching machines —
  // do not reload the saved polygon (that would continue editing old nodes).
  useEffect(() => {
    if (!editMode) return
    setDraftPoints([])
  }, [editMode, editStation])

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
    if (editMode || antennaMode) return
    if (e.shiftKey) {
      e.preventDefault()
      togglePinStation(machine.station)
      return
    }
    setSelectedMachine(machine)
  }, [antennaMode, editMode, togglePinStation])

  const handlePartClick = useCallback((session) => {
    if (editMode || antennaMode) return
    const station = stationsWithShapes.find(s => s.station === session.station_name)
      ?? PRODUCTION_LINE_STATIONS.find(s => s.station === session.station_name)
    if (station) setSelectedMachine(station)
  }, [antennaMode, editMode, stationsWithShapes])

  const enterEditMode = useCallback(() => {
    setAntennaMode(false)
    setEditMode(true)
    setSelectedMachine(null)
    setDraftPoints([])
  }, [])

  const exitEditMode = useCallback(() => {
    setEditMode(false)
    setDraftPoints([])
    if (dirty) {
      setShapesMap(shapesBaseline.current)
      setDirty(false)
    }
  }, [dirty])

  const enterAntennaMode = useCallback(() => {
    setEditMode(false)
    setDraftPoints([])
    setAntennaMode(true)
    setSelectedMachine(null)
    setShowAntennaMarkers(true)
  }, [])

  const exitAntennaMode = useCallback(() => {
    setAntennaMode(false)
    if (antennaDirty) {
      setAntennaPlacements(antennaBaseline.current)
      setAntennaDirty(false)
    }
  }, [antennaDirty])

  const handlePlaceAntenna = useCallback((antennaId, x, y, opts = {}) => {
    const id = String(antennaId)
    setAntennaPlacements(prev => {
      const existing = prev[id]
      const wasNew = !existing
      const next = {
        ...prev,
        [id]: {
          x,
          y,
          visible: opts.keepVisible && existing ? existing.visible !== false : true,
        },
      }
      // After placing a new antenna, select the next one that still needs a pin
      if (wasNew && !opts.keepVisible) {
        const nextUnplaced = antennas.find(a => {
          const aid = String(a.antenna_id)
          return aid !== id && !next[aid]
        })
        if (nextUnplaced) {
          queueMicrotask(() => setSelectedAntennaId(String(nextUnplaced.antenna_id)))
        } else {
          queueMicrotask(() => setSelectedAntennaId(id))
        }
      }
      return next
    })
    setAntennaDirty(true)
    if (opts.keepVisible) setSelectedAntennaId(id)
  }, [antennas])

  const handleRemoveAntennaPlacement = useCallback((antennaId) => {
    if (antennaId == null || antennaId === '') return
    const id = String(antennaId)
    setAntennaPlacements(prev => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setAntennaDirty(true)
  }, [])

  const handleRemoveAllAntennas = useCallback(() => {
    if (Object.keys(antennaPlacements).length === 0) return
    if (!window.confirm('Remove all antenna pins from the map?')) return
    setAntennaPlacements({})
    setAntennaDirty(true)
  }, [antennaPlacements])

  const handleSaveAntennaPlacements = useCallback(async () => {
    setAntennaSaving(true)
    try {
      const saved = await apiPut('/api/antenna-placements', placementsToPayload(antennaPlacements))
      const normalized = normalizeAntennaPlacements(saved)
      setAntennaPlacements(normalized)
      antennaBaseline.current = normalized
      setAntennaDirty(false)
      setShapeMessage('Antenna placements saved.')
    } catch {
      setShapeMessage('Could not save antenna placements — is the API running?')
    } finally {
      setAntennaSaving(false)
    }
  }, [antennaPlacements])

  const commitDraftToShapes = useCallback((points) => {
    setShapesMap(prev => {
      const next = { ...prev }
      if (!points || points.length < 3) {
        delete next[editStation]
      } else {
        next[editStation] = { polygon: points.map(([x, y]) => [x, y]) }
      }
      return next
    })
    setDirty(true)
  }, [editStation])

  const handleCloseShape = useCallback(() => {
    if (draftPoints.length < 3) return
    commitDraftToShapes(draftPoints)
    setDraftPoints([])
    setShapeMessage(`Closed shape for ${editStation}. Click Save to keep it — or click the map to draw a new one.`)
  }, [commitDraftToShapes, draftPoints, editStation])

  const handleEditExistingShape = useCallback(() => {
    const existing = shapesMap[editStation]?.polygon
    if (!existing || existing.length < 3) return
    setDraftPoints(existing.map(([x, y]) => [x, y]))
    setShapeMessage(`Editing ${editStation} — drag corners, or Remove and redraw.`)
  }, [editStation, shapesMap])

  const persistShapes = useCallback(async (nextMap, successMessage) => {
    setSaving(true)
    try {
      const saved = await apiPut('/api/machine-shapes', shapesToPayload(nextMap))
      const normalized = normalizeShapesMap(saved)
      setShapesMap(normalized)
      shapesBaseline.current = normalized
      setDirty(false)
      setShapeMessage(successMessage ?? 'Machine shapes saved.')
      return true
    } catch {
      setShapeMessage('Could not save shapes — is the API running?')
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const handleRemoveShape = useCallback(async (stationKey = editStation) => {
    const label = PRODUCTION_LINE_STATIONS.find(s => s.station === stationKey)?.name ?? stationKey
    if (!window.confirm(`Remove the shape for ${label}?`)) return

    const nextMap = { ...shapesMap }
    delete nextMap[stationKey]
    if (stationKey === editStation) setDraftPoints([])
    setShapesMap(nextMap)
    await persistShapes(nextMap, `Removed shape for ${label}.`)
  }, [editStation, persistShapes, shapesMap])

  const handleUndoPoint = useCallback(() => {
    setDraftPoints(prev => prev.slice(0, -1))
  }, [])

  const handleSelectEditStation = useCallback((station) => {
    // Persist current draft into shapes before switching, then start fresh
    if (draftPoints.length >= 3) {
      commitDraftToShapes(draftPoints)
    }
    setDraftPoints([])
    setEditStation(station)
  }, [commitDraftToShapes, draftPoints])

  const handleSaveShapes = useCallback(async () => {
    let nextMap = shapesMap
    if (draftPoints.length >= 3) {
      nextMap = {
        ...shapesMap,
        [editStation]: { polygon: draftPoints.map(([x, y]) => [x, y]) },
      }
      setShapesMap(nextMap)
    }
    await persistShapes(nextMap)
  }, [draftPoints, editStation, persistShapes, shapesMap])

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
  const showConfigWarning = health != null && !health.enabled
  const showDisconnected = rtlsEnabled && !connected && operators.length === 0
  const showNoPositions = rtlsEnabled && connected && operators.length === 0
  const hasPinnedQueues = orderedPinnedStations.length > 0
  const allMachineStatuses = useMemo(
    () => getAllStationStatuses(productionStations, PRODUCTION_LINE_ORDER, sessionsByStation, rtls),
    [productionStations, sessionsByStation, rtls],
  )
  const visibleMachineStatuses = useMemo(
    () => allMachineStatuses.filter(s => visibleMachineSet.has(s.stationKey)),
    [allMachineStatuses, visibleMachineSet],
  )
  const machinesInUseCount = useMemo(
    () => allMachineStatuses.filter(s => s.inUse).length,
    [allMachineStatuses],
  )

  const selectedMachineLive = useMemo(() => {
    if (!selectedMachine) return null
    return stationsWithShapes.find(s => s.station === selectedMachine.station) ?? selectedMachine
  }, [selectedMachine, stationsWithShapes])

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(420px,40vw)] gap-3 items-start">
      <div className="space-y-3 min-w-0">
      <Panel
        title="Floor Plan"
        subtitle="Operators at live XY · parts at last RFID antenna"
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

        {shapeMessage && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-sky-700 dark:text-sky-300
                          bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20
                          rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {shapeMessage}
          </div>
        )}

        <div className="px-4 sm:px-5 pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1 shrink-0">
              <Pin className="w-3 h-3" />
              Queues
            </span>
            {PINNABLE_STATIONS.map(name => {
              const pinned = pinnedSet.has(name)
              const count = sessionsByStation[name]?.length ?? 0
              const label = PRODUCTION_LINE_STATIONS.find(s => s.station === name)?.name ?? name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => togglePinStation(name)}
                  disabled={!pinned && pinLimitReached}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium
                              border transition-colors
                    ${pinned
                      ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30 dark:hover:bg-blue-500/25'
                      : pinLimitReached
                        ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                        : 'bg-transparent text-gray-600 border-gray-200/80 hover:border-violet-300 hover:text-violet-700 dark:text-slate-300 dark:border-slate-600 dark:hover:border-violet-500/40'
                    }`}
                  title={pinned ? `Unpin ${label}` : `Pin ${label} queue`}
                >
                  {label}
                  {count > 0 && (
                    <span className={`tabular-nums ${pinned ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1 shrink-0">
              <Factory className="w-3 h-3" />
              Machines
            </span>
            {PRODUCTION_LINE_STATIONS.map(st => {
              const visible = visibleMachineSet.has(st.station)
              const status = allMachineStatuses.find(s => s.stationKey === st.station)
              const inUse = status?.inUse
              const light = status?.light
              const hasShape = Boolean(shapesMap[st.station]?.polygon?.length >= 3)
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => toggleMachineVisibility(st.station)}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium
                              border transition-colors
                    ${visible
                      ? inUse
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 dark:hover:bg-emerald-500/25'
                        : light === 'amber'
                          ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700'
                      : 'bg-transparent text-gray-400 border-transparent hover:border-gray-300 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300'
                    }`}
                  title={visible ? `Hide ${st.name} from status table` : `Show ${st.name}`}
                >
                  {visible && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0
                      ${inUse
                        ? 'bg-green-500'
                        : light === 'amber'
                          ? 'bg-amber-500'
                          : 'bg-slate-300 dark:bg-slate-500'
                      }`}
                    />
                  )}
                  {st.name}
                  {shapesLoaded && hasShape && visible && (
                    <span className="w-1 h-1 rounded-full bg-sky-400 shrink-0" title="Has map shape" />
                  )}
                </button>
              )
            })}
            {hasVisibleMachines ? (
              <button
                type="button"
                onClick={hideAllMachines}
                className="text-xs text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 px-1"
                title="Hide all machines"
              >
                Hide all
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setVisibleMachines(defaultVisibleMachines())}
                className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 px-1"
              >
                Show all
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5 border-t border-gray-100 dark:border-slate-700/60">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 shrink-0">
              Map
            </span>
            <button
              type="button"
              onClick={editMode ? exitEditMode : enterEditMode}
              disabled={antennaMode}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
                          border transition-colors disabled:opacity-40
                ${editMode
                  ? 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40'
                  : 'bg-transparent text-gray-600 border-gray-200 hover:border-sky-300 hover:text-sky-700 dark:text-slate-300 dark:border-slate-600'
                }`}
              title="Draw machine shapes on the floor plan"
            >
              <Pencil className="w-3 h-3" />
              {editMode ? 'Exit draw' : 'Draw shapes'}
            </button>
            <button
              type="button"
              onClick={antennaMode ? exitAntennaMode : enterAntennaMode}
              disabled={editMode}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
                          border transition-colors disabled:opacity-40
                ${antennaMode
                  ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40'
                  : 'bg-transparent text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-700 dark:text-slate-300 dark:border-slate-600'
                }`}
              title="Place RFID antennas used for part chip locations"
            >
              <MapPin className="w-3 h-3" />
              {antennaMode ? 'Exit antennas' : 'Place antennas'}
            </button>
            {!antennaMode && (
              <button
                type="button"
                onClick={() => setShowAntennaMarkers(v => !v)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
                           text-gray-500 border border-gray-200 dark:border-slate-600
                           hover:bg-gray-50 dark:hover:bg-slate-800"
                title={showAntennaMarkers ? 'Hide antenna pins' : 'Show antenna pins'}
              >
                {showAntennaMarkers ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {showAntennaMarkers ? 'Pins on' : 'Pins off'}
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
            <div className={`relative ${hasPinnedQueues ? 'min-w-0 flex items-start' : ''}`}>
              {editMode && (
                <MachineShapeToolbar
                  draftPoints={draftPoints}
                  selectedStation={editStation}
                  onSelectStation={handleSelectEditStation}
                  onCloseShape={handleCloseShape}
                  onUndoPoint={handleUndoPoint}
                  onRemoveShape={() => handleRemoveShape(editStation)}
                  onRemoveStation={handleRemoveShape}
                  onEditExisting={handleEditExistingShape}
                  onCancel={exitEditMode}
                  onSave={handleSaveShapes}
                  saving={saving}
                  dirty={dirty || draftPoints.length >= 3}
                  canRemove={Boolean(shapesMap[editStation]?.polygon?.length >= 3)}
                  shapedStations={PRODUCTION_LINE_STATIONS.filter(
                    s => shapesMap[s.station]?.polygon?.length >= 3,
                  )}
                  stations={PRODUCTION_LINE_STATIONS}
                />
              )}
              {antennaMode && (
                <AntennaPlaceToolbar
                  antennas={antennas}
                  selectedId={selectedAntennaId}
                  onSelect={setSelectedAntennaId}
                  placements={antennaPlacements}
                  onRemove={handleRemoveAntennaPlacement}
                  onRemoveAll={handleRemoveAllAntennas}
                  onSave={handleSaveAntennaPlacements}
                  onCancel={exitAntennaMode}
                  saving={antennaSaving}
                  dirty={antennaDirty}
                  showMarkers={showAntennaMarkers}
                  onToggleShowMarkers={() => setShowAntennaMarkers(v => !v)}
                />
              )}
              <FloorPlanMap
                rtls={rtls}
                sessionsByStation={sessionsByStation}
                liveSessions={liveSessions}
                operators={operators}
                zoneByTag={zoneByTag}
                selectedMachine={selectedMachine}
                pinnedSet={pinnedSet}
                onMachineClick={handleMachineClick}
                onPartClick={handlePartClick}
                machines={mapMachines}
                stationsForPresence={stationsWithShapes}
                editMode={editMode}
                editStation={editStation}
                draftPoints={draftPoints}
                onDraftChange={setDraftPoints}
                onCloseShape={handleCloseShape}
                antennaMode={antennaMode}
                antennas={antennas}
                antennaPlacements={antennaPlacements}
                selectedAntennaId={selectedAntennaId}
                onPlaceAntenna={handlePlaceAntenna}
                onSelectAntenna={setSelectedAntennaId}
                onRemoveAntenna={handleRemoveAntennaPlacement}
                showAntennaMarkers={showAntennaMarkers}
                mapRef={mapRef}
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
            {editMode
              ? 'Draw mode — click corners around a machine, then Done · Save to persist'
              : antennaMode
                ? 'Antenna mode — select an antenna, click the map to place it · Save to persist · Hide pins anytime'
                : hasPinnedQueues
                  ? 'Amber chips = parts at last antenna · Round dots = operators · Shift+click machine to pin queue'
                  : 'Amber chips = parts at last antenna · Round dots = operators · Click machine or chip for details'}
            {!editMode && !antennaMode && hasVisibleMachines
              ? ` · ${visibleMachineStatuses.length} machine${visibleMachineStatuses.length !== 1 ? 's' : ''} shown (${machinesInUseCount} in use)`
              : ''}
            {' · '}Origin at white rectangle top-left · {FLOOR_PLAN.scalePxPerM} px/m
          </p>
        </div>
      </Panel>

      {selectedMachineLive && (
        <StationDetailModal
          machine={selectedMachineLive}
          sessions={sessionsByStation[selectedMachineLive.station] ?? []}
          operatorsInZone={operatorsInMachineZone(rtls, selectedMachineLive, stationsWithShapes)}
          onClose={() => setSelectedMachine(null)}
          isPinned={pinnedSet.has(selectedMachineLive.station)}
          pinLimitReached={pinLimitReached}
          onTogglePin={() => togglePinStation(selectedMachineLive.station)}
        />
      )}
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-5.5rem)] xl:overflow-hidden flex flex-col min-h-[420px]">
        <IbusOrdersSidebar journeys={openIbusJourneys} />
      </div>
    </div>
  )
}
