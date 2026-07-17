import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Map as MapIcon, AlertCircle, MapPin, Eye, EyeOff, UserRound } from 'lucide-react'
import { Panel } from '../components/Panel'
import { MachineOverlaySvg } from '../components/MachineOverlay'
import { AntennaPlaceToolbar, AntennaPlaceLayer, AntennaMarkers } from '../components/AntennaEditor'
import { StationPlaceToolbar, StationPlaceLayer, StationMarkers } from '../components/StationEditor'
import { PartChipLayer } from '../components/PartChipLayer'
import { MachineStatusTable } from '../components/MachineStatusPanel'
import { IbusOrdersSidebar } from '../components/IbusOrdersSidebar'
import { useRtlsLive } from '../hooks/useRtlsLive'
import { apiFetch, apiPut, apiPost, apiDelete } from '../api'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { normalizeShapesMap, polygonCentroid } from '../utils/machinePolygons'
import {
  normalizeAntennaPlacements,
  placementsToPayload,
} from '../utils/antennaPlacements'
import {
  normalizeStationPlacements,
  stationPlacementsToPayload,
} from '../utils/stationPlacements'
import {
  ALL_STATIONS,
  PRODUCTION_LINE_ORDER,
  PRODUCTION_LINE_STATIONS,
  applyMachineShapes,
  machinesWithPolygons,
  operatorsByStation,
} from '../utils/machineRegions'
import { getAllStationStatuses } from '../utils/stationStatus'
import floorPlanImg from '../assets/floor_plan.png'

const SHOW_ANTENNAS_KEY = 'liveDashboard.showAntennaMarkers'
const SHOW_STATIONS_KEY = 'liveDashboard.showStationMarkers'

function OperatorMarker({ op, zoneName, pos, mapBusy = false, stackIndex = 0 }) {
  const title = [
    op.operator_name || `Tag ${op.tag_id}`,
    zoneName,
  ].filter(Boolean).join(' · ')

  const offsetPx = stackIndex * 10

  return (
    <div
      data-floor-marker
      className={`absolute z-20 ${mapBusy ? 'pointer-events-none opacity-80' : 'pointer-events-auto'}`}
      style={{
        left: pos.left,
        top: pos.top,
        transform: `translate(calc(-50% + ${offsetPx}px), -50%)`,
      }}
      title={title}
    >
      <span className="relative flex items-center justify-center w-2.5 h-2.5 rounded-full
                      ring-2 ring-white/90 shadow-[0_0_10px_rgba(255,255,255,0.5)] bg-white">
        <span className="absolute inset-0 rounded-full animate-ping opacity-25 bg-white [animation-duration:1.8s]" />
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
  liveSessions,
  operators,
  machines,
  antennaMode,
  stationMode,
  antennas,
  antennaPlacements,
  selectedAntennaId,
  onPlaceAntenna,
  onSelectAntenna,
  onRemoveAntenna,
  showAntennaMarkers,
  stations,
  stationPlacements,
  selectedStationId,
  onPlaceStation,
  onSelectStation,
  onRemoveStation,
  showStationMarkers,
  mapRef,
}) {
  const mapBusy = antennaMode || stationMode

  return (
    <div
      ref={mapRef}
      className="relative w-full min-w-0 rounded-lg bg-black shadow-inner ring-1 ring-gray-200 dark:ring-slate-700"
      style={{ aspectRatio: `${FLOOR_PLAN.imageWidth} / ${FLOOR_PLAN.imageHeight}` }}
    >
      <img
        src={floorPlanImg}
        alt="Machine floor plan"
        className="absolute inset-0 w-full h-full object-fill select-none rounded-lg"
        draggable={false}
      />
      <div className="absolute inset-0 z-10 overflow-visible rounded-lg">
        {!mapBusy && (
          <MachineOverlaySvg className="z-10 pointer-events-none">
            <AntennaMarkers
              placements={antennaPlacements}
              antennas={antennas}
              showMarkers={showAntennaMarkers}
            />
            <StationMarkers
              placements={stationPlacements}
              stations={stations}
              showMarkers={showStationMarkers}
            />
          </MachineOverlaySvg>
        )}
        {!mapBusy && (
          <PartChipLayer
            sessions={liveSessions}
            placements={antennaPlacements}
            machines={machines}
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
        {stationMode && (
          <StationPlaceLayer
            mapRef={mapRef}
            selectedId={selectedStationId}
            placements={stationPlacements}
            stations={stations}
            onPlace={onPlaceStation}
            onSelect={onSelectStation}
            onRemove={onRemoveStation}
          />
        )}
        {operators.map((entry) => (
          <OperatorMarker
            key={entry.op.tag_id}
            op={entry.op}
            pos={entry.pos}
            zoneName={entry.zoneName}
            stackIndex={entry.stackIndex}
            mapBusy={mapBusy}
          />
        ))}
      </div>
    </div>
  )
}

const MemoFloorPlanMap = memo(FloorPlanMap)

export function LiveDashboard({ liveSessions = [], tick = 0 }) {
  const { rtls, health, error, refresh } = useRtlsLive()

  // Shapes still load as a fallback for part chips — map regions are hidden.
  const [shapesMap, setShapesMap] = useState({})
  const [statusMessage, setStatusMessage] = useState(null)
  const [demoBusy, setDemoBusy] = useState(false)
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
  const [stationPlacements, setStationPlacements] = useState({})
  const [stationMode, setStationMode] = useState(false)
  const [selectedStationId, setSelectedStationId] = useState(
    PRODUCTION_LINE_STATIONS[0]?.station ?? null,
  )
  const [stationDirty, setStationDirty] = useState(false)
  const [stationSaving, setStationSaving] = useState(false)
  const [showStationMarkers, setShowStationMarkers] = useState(() => {
    try {
      const raw = localStorage.getItem(SHOW_STATIONS_KEY)
      return raw == null ? true : raw === 'true'
    } catch {
      return true
    }
  })
  const mapRef = useRef(null)
  const antennaBaseline = useRef({})
  const stationBaseline = useRef({})
  const [openIbusJourneys, setOpenIbusJourneys] = useState([])

  const loadOpenIbus = useCallback(() => {
    apiFetch('/api/ibus?status=open&limit=80')
      .then(rows => {
        if (Array.isArray(rows)) setOpenIbusJourneys(rows)
      })
      .catch(() => {})
  }, [])

  // Refresh progress bars on every rfid_update (and socket fallback tick).
  useEffect(() => {
    loadOpenIbus()
  }, [tick, loadOpenIbus])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/api/machine-shapes').catch(() => ({})),
      apiFetch('/api/antenna-placements').catch(() => ({})),
      apiFetch('/api/antennas').catch(() => []),
      apiFetch('/api/station-placements').catch(() => ({})),
    ]).then(([shapes, placements, ants, stationPins]) => {
      if (cancelled) return
      setShapesMap(normalizeShapesMap(shapes))
      const normalizedPlacements = normalizeAntennaPlacements(placements)
      setAntennaPlacements(normalizedPlacements)
      antennaBaseline.current = normalizedPlacements
      const list = Array.isArray(ants) ? ants : []
      setAntennas(list)
      if (list.length > 0) {
        setSelectedAntennaId(String(list[0].antenna_id))
      }
      const normalizedStations = normalizeStationPlacements(stationPins)
      setStationPlacements(normalizedStations)
      stationBaseline.current = normalizedStations
      const firstUnplaced = PRODUCTION_LINE_STATIONS.find(s => !normalizedStations[s.station])
      if (firstUnplaced) setSelectedStationId(firstUnplaced.station)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    localStorage.setItem(SHOW_ANTENNAS_KEY, String(showAntennaMarkers))
  }, [showAntennaMarkers])

  useEffect(() => {
    localStorage.setItem(SHOW_STATIONS_KEY, String(showStationMarkers))
  }, [showStationMarkers])

  const stationsWithShapes = useMemo(
    () => applyMachineShapes(ALL_STATIONS, shapesMap),
    [shapesMap],
  )
  const mapMachines = useMemo(
    () => machinesWithPolygons(stationsWithShapes),
    [stationsWithShapes],
  )

  useEffect(() => {
    if (!statusMessage) return
    const t = setTimeout(() => setStatusMessage(null), 4000)
    return () => clearTimeout(t)
  }, [statusMessage])

  const sessionsByStation = useMemo(() => {
    const grouped = {}
    for (const session of liveSessions) {
      const name = session.station_name ?? 'Unknown'
      if (!grouped[name]) grouped[name] = []
      grouped[name].push(session)
    }
    return grouped
  }, [liveSessions])

  const enterAntennaMode = useCallback(() => {
    setStationMode(false)
    setAntennaMode(true)
    setShowAntennaMarkers(true)
    // Re-fetch so newly seeded antennas (4–7) show up without a full page reload
    apiFetch('/api/antennas')
      .then((list) => {
        const ants = Array.isArray(list) ? list : []
        setAntennas(ants)
        const placed = antennaBaseline.current || {}
        const firstUnplaced = ants.find(a => !placed[String(a.antenna_id)])
          || ants.find(a => !antennaPlacements[String(a.antenna_id)])
        const pick = firstUnplaced || ants[0]
        if (pick) setSelectedAntennaId(String(pick.antenna_id))
      })
      .catch(() => {})
  }, [antennaPlacements])

  const exitAntennaMode = useCallback(() => {
    setAntennaMode(false)
    if (antennaDirty) {
      setAntennaPlacements(antennaBaseline.current)
      setAntennaDirty(false)
    }
  }, [antennaDirty])

  const enterStationMode = useCallback(() => {
    setAntennaMode(false)
    setStationMode(true)
    setShowStationMarkers(true)
  }, [])

  const exitStationMode = useCallback(() => {
    setStationMode(false)
    if (stationDirty) {
      setStationPlacements(stationBaseline.current)
      setStationDirty(false)
    }
  }, [stationDirty])

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
      setStatusMessage('Antenna placements saved.')
    } catch {
      setStatusMessage('Could not save antenna placements — is the API running?')
    } finally {
      setAntennaSaving(false)
    }
  }, [antennaPlacements])

  const handlePlaceStation = useCallback((stationKey, x, y, opts = {}) => {
    const id = String(stationKey)
    setStationPlacements(prev => {
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
      if (wasNew && !opts.keepVisible) {
        const nextUnplaced = PRODUCTION_LINE_STATIONS.find(s => !next[s.station])
        if (nextUnplaced) {
          queueMicrotask(() => setSelectedStationId(nextUnplaced.station))
        } else {
          queueMicrotask(() => setSelectedStationId(id))
        }
      }
      return next
    })
    setStationDirty(true)
    if (opts.keepVisible) setSelectedStationId(id)
  }, [])

  const handleRemoveStationPlacement = useCallback((stationKey) => {
    if (stationKey == null || stationKey === '') return
    const id = String(stationKey)
    setStationPlacements(prev => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setStationDirty(true)
  }, [])

  const handleRemoveAllStations = useCallback(() => {
    if (Object.keys(stationPlacements).length === 0) return
    if (!window.confirm('Remove all station pins from the map?')) return
    setStationPlacements({})
    setStationDirty(true)
  }, [stationPlacements])

  const handleSaveStationPlacements = useCallback(async () => {
    setStationSaving(true)
    try {
      const saved = await apiPut('/api/station-placements', stationPlacementsToPayload(stationPlacements))
      const normalized = normalizeStationPlacements(saved)
      setStationPlacements(normalized)
      stationBaseline.current = normalized
      setStationDirty(false)
      setStatusMessage('Station pins saved.')
    } catch {
      setStatusMessage('Could not save station pins — is the API running?')
    } finally {
      setStationSaving(false)
    }
  }, [stationPlacements])

  const loadDemoOperators = useCallback(async () => {
    setDemoBusy(true)
    try {
      await apiPost('/api/rtls/demo')
      await refresh()
      setStatusMessage('Demo operators loaded — place station pins to show them on the map')
    } catch {
      setStatusMessage('Could not load demo operators — restart the API (start.ps1) first')
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

  const operatorsByStationMap = useMemo(
    () => operatorsByStation(rtls, stationsWithShapes),
    [rtls, stationsWithShapes],
  )

  const operators = useMemo(() => {
    const machinesByStation = new Map(stationsWithShapes.map(m => [m.station, m]))
    const stationMeta = new Map(PRODUCTION_LINE_STATIONS.map(s => [s.station, s]))
    const markers = []
    for (const [station, ops] of operatorsByStationMap) {
      if (ops.length === 0) continue
      const pin = stationPlacements[station]
      const machine = machinesByStation.get(station)
      let x = null
      let y = null
      if (pin && Number.isFinite(pin.x) && Number.isFinite(pin.y)) {
        x = pin.x
        y = pin.y
      } else if (machine?.polygon?.length >= 3) {
        // Temporary fallback while pins are being placed
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
  }, [operatorsByStationMap, stationsWithShapes, stationPlacements])

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
    () => getAllStationStatuses(PRODUCTION_LINE_STATIONS, PRODUCTION_LINE_ORDER, sessionsByStation, rtls, operatorsByStationMap),
    [sessionsByStation, rtls, operatorsByStationMap],
  )
  const machinesInUseCount = useMemo(
    () => allMachineStatuses.filter(s => s.inUse).length,
    [allMachineStatuses],
  )

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
      <Panel
        className="min-w-0 flex flex-col"
        title="Floor Plan"
        subtitle="Operators by zone · parts at last RFID antenna"
        icon={MapIcon}
        iconColor="text-violet-500 dark:text-violet-400"
      >
        {error && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-red-600 dark:text-red-400 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {showConfigWarning && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300
                          bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20
                          rounded-lg px-3 py-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            RTLS ingestion is disabled. Set ENABLE_LIVE_INGESTION=true in .env and restart the API.
          </div>
        )}

        {showDisconnected && (
          <div className="mx-5 mt-4 flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300
                          bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20
                          rounded-lg px-3 py-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0">
              Sewio WebSocket is disconnected — waiting for zone events. Check factory network access to 10.25.80.13.
            </span>
            <button
              type="button"
              disabled={demoBusy}
              onClick={loadDemoOperators}
              className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium
                         bg-amber-600/90 hover:bg-amber-600 text-white disabled:opacity-50"
            >
              {demoBusy ? 'Loading…' : 'Load demo operators'}
            </button>
          </div>
        )}

        {showNoPositions && (
          <div className="mx-5 mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300
                          bg-slate-50 dark:bg-slate-500/10 border border-slate-200 dark:border-slate-500/20
                          rounded-lg px-3 py-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0">
              Connected to Sewio but no operators in a mapped zone yet.
            </span>
            <button
              type="button"
              disabled={demoBusy}
              onClick={loadDemoOperators}
              className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium
                         bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50"
            >
              {demoBusy ? 'Loading…' : 'Load demo operators'}
            </button>
          </div>
        )}

        {operators.length > 0 && (
          <div className="mx-5 mt-4 flex justify-end shrink-0">
            <button
              type="button"
              disabled={demoBusy}
              onClick={clearDemoOperators}
              className="px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 dark:text-slate-400
                         hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Clear demo operators
            </button>
          </div>
        )}

        {statusMessage && (
          <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-sky-700 dark:text-sky-300
                          bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20
                          rounded-lg px-3 py-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {statusMessage}
          </div>
        )}

        <div className="px-4 sm:px-5 pt-4 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 shrink-0">
              Map
            </span>
            <button
              type="button"
              onClick={antennaMode ? exitAntennaMode : enterAntennaMode}
              disabled={stationMode}
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
            <button
              type="button"
              onClick={stationMode ? exitStationMode : enterStationMode}
              disabled={antennaMode}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
                          border transition-colors disabled:opacity-40
                ${stationMode
                  ? 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40'
                  : 'bg-transparent text-gray-600 border-gray-200 hover:border-sky-300 hover:text-sky-700 dark:text-slate-300 dark:border-slate-600'
                }`}
              title="Place station pins used for operator locations"
            >
              <UserRound className="w-3 h-3" />
              {stationMode ? 'Exit stations' : 'Place stations'}
            </button>
            {!antennaMode && !stationMode && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAntennaMarkers(v => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
                             text-gray-500 border border-gray-200 dark:border-slate-600
                             hover:bg-gray-50 dark:hover:bg-slate-800"
                  title={showAntennaMarkers ? 'Hide antenna pins' : 'Show antenna pins'}
                >
                  {showAntennaMarkers ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  Antennas
                </button>
                <button
                  type="button"
                  onClick={() => setShowStationMarkers(v => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
                             text-gray-500 border border-gray-200 dark:border-slate-600
                             hover:bg-gray-50 dark:hover:bg-slate-800"
                  title={showStationMarkers ? 'Hide station pins' : 'Show station pins'}
                >
                  {showStationMarkers ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  Stations
                </button>
              </>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5 pt-3">
          <div className="relative">
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
            {stationMode && (
              <StationPlaceToolbar
                stations={PRODUCTION_LINE_STATIONS}
                selectedId={selectedStationId}
                onSelect={setSelectedStationId}
                placements={stationPlacements}
                onRemove={handleRemoveStationPlacement}
                onRemoveAll={handleRemoveAllStations}
                onSave={handleSaveStationPlacements}
                onCancel={exitStationMode}
                saving={stationSaving}
                dirty={stationDirty}
                showMarkers={showStationMarkers}
                onToggleShowMarkers={() => setShowStationMarkers(v => !v)}
              />
            )}
            <MemoFloorPlanMap
              liveSessions={liveSessions}
              operators={operators}
              machines={mapMachines}
              antennaMode={antennaMode}
              stationMode={stationMode}
              antennas={antennas}
              antennaPlacements={antennaPlacements}
              selectedAntennaId={selectedAntennaId}
              onPlaceAntenna={handlePlaceAntenna}
              onSelectAntenna={setSelectedAntennaId}
              onRemoveAntenna={handleRemoveAntennaPlacement}
              showAntennaMarkers={showAntennaMarkers}
              stations={PRODUCTION_LINE_STATIONS}
              stationPlacements={stationPlacements}
              selectedStationId={selectedStationId}
              onPlaceStation={handlePlaceStation}
              onSelectStation={setSelectedStationId}
              onRemoveStation={handleRemoveStationPlacement}
              showStationMarkers={showStationMarkers}
              mapRef={mapRef}
            />
          </div>

          <p className="mt-3 text-xs text-gray-500 dark:text-slate-400 text-center">
            {antennaMode
              ? 'Antenna mode — select an antenna, click the map to place it · Save to persist'
              : stationMode
                ? 'Station mode — select a machine, click the map to place its operator pin · Save to persist'
                : 'Colored chips = parts by IBUS order · White dots = operators at station pins'}
            {!antennaMode && !stationMode
              ? ` · ${allMachineStatuses.length} machines (${machinesInUseCount} in use)`
              : ''}
            {' · '}Origin at white rectangle top-left · {FLOOR_PLAN.scalePxPerM} px/m
          </p>
        </div>
      </Panel>

      <div className="min-w-0 min-h-[24rem] lg:min-h-0 h-full self-stretch overflow-hidden">
        <IbusOrdersSidebar journeys={openIbusJourneys} />
      </div>
      </div>

      <div className="min-h-[16rem]">
        <MachineStatusTable statuses={allMachineStatuses} />
      </div>
    </div>
  )
}
