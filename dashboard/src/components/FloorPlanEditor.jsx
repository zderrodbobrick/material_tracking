import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { MapPin, UserRound } from 'lucide-react'
import { MachineOverlaySvg } from './MachineOverlay'
import { AntennaPlaceToolbar, AntennaPlaceLayer, AntennaMarkers } from './AntennaEditor'
import { StationPlaceToolbar, StationPlaceLayer, StationMarkers } from './StationEditor'
import { apiFetch, apiPut } from '../api'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import {
 normalizeAntennaPlacements,
 placementsToPayload,
} from '../utils/antennaPlacements'
import {
 normalizeStationPlacements,
 stationPlacementsToPayload,
} from '../utils/stationPlacements'
import { PRODUCTION_LINE_STATIONS } from '../utils/machineRegions'
import floorPlanImg from '../assets/floor_plan.png'

function FloorMap({
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
 return (
  <div
   ref={mapRef}
   className="relative w-full min-w-0 rounded-[6px] bg-black ring-1 ring-[#2a2a32]"
   style={{ aspectRatio: `${FLOOR_PLAN.imageWidth} / ${FLOOR_PLAN.imageHeight}` }}
  >
   <img
    src={floorPlanImg}
    alt="Floor plan"
    className="absolute inset-0 w-full h-full object-fill select-none rounded-[6px]"
    draggable={false}
   />
   <div className="absolute inset-0 z-10 overflow-visible rounded-[6px]">
    {!antennaMode && !stationMode && (
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
   </div>
  </div>
 )
}

const MemoFloorMap = memo(FloorMap)

/**
 * Floor plan antenna/station pin editor for Settings.
 */
export function FloorPlanEditor() {
 const [antennas, setAntennas] = useState([])
 const [antennaPlacements, setAntennaPlacements] = useState({})
 const [stationPlacements, setStationPlacements] = useState({})
 const [antennaMode, setAntennaMode] = useState(false)
 const [stationMode, setStationMode] = useState(false)
 const [selectedAntennaId, setSelectedAntennaId] = useState(null)
 const [selectedStationId, setSelectedStationId] = useState(
  PRODUCTION_LINE_STATIONS[0]?.station ?? null,
 )
 const [antennaDirty, setAntennaDirty] = useState(false)
 const [stationDirty, setStationDirty] = useState(false)
 const [antennaSaving, setAntennaSaving] = useState(false)
 const [stationSaving, setStationSaving] = useState(false)
 const [showAntennaMarkers, setShowAntennaMarkers] = useState(true)
 const [showStationMarkers, setShowStationMarkers] = useState(true)
 const [message, setMessage] = useState(null)
 const mapRef = useRef(null)
 const antennaBaseline = useRef({})
 const stationBaseline = useRef({})

 useEffect(() => {
  let cancelled = false
  Promise.all([
   apiFetch('/api/antenna-placements').catch(() => ({})),
   apiFetch('/api/antennas').catch(() => []),
   apiFetch('/api/station-placements').catch(() => ({})),
  ]).then(([placements, ants, stationPins]) => {
   if (cancelled) return
   const normalizedPlacements = normalizeAntennaPlacements(placements)
   setAntennaPlacements(normalizedPlacements)
   antennaBaseline.current = normalizedPlacements
   const list = Array.isArray(ants) ? ants : []
   setAntennas(list)
   if (list[0]) setSelectedAntennaId(String(list[0].antenna_id))
   const normalizedStations = normalizeStationPlacements(stationPins)
   setStationPlacements(normalizedStations)
   stationBaseline.current = normalizedStations
  })
  return () => { cancelled = true }
 }, [])

 useEffect(() => {
  if (!message) return
  const t = setTimeout(() => setMessage(null), 3500)
  return () => clearTimeout(t)
 }, [message])

 const enterAntennaMode = useCallback(() => {
  setStationMode(false)
  setAntennaMode(true)
  setShowAntennaMarkers(true)
  apiFetch('/api/antennas')
   .then((list) => {
    const ants = Array.isArray(list) ? ants : []
    setAntennas(ants)
    const placed = antennaBaseline.current || {}
    const firstUnplaced = ants.find(a => !placed[String(a.antenna_id)])
    if (firstUnplaced) setSelectedAntennaId(String(firstUnplaced.antenna_id))
    else if (ants[0]) setSelectedAntennaId(String(ants[0].antenna_id))
   })
   .catch(() => {})
 }, [])

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
   if (wasNew && !opts.keepVisible) {
    const nextUnplaced = antennas.find(a => {
     const aid = String(a.antenna_id)
     return aid !== id && !next[aid]
    })
    queueMicrotask(() => setSelectedAntennaId(String(nextUnplaced?.antenna_id ?? id)))
   }
   return next
  })
  setAntennaDirty(true)
  if (opts.keepVisible) setSelectedAntennaId(id)
 }, [antennas])

 const handleRemoveAntenna = useCallback((antennaId) => {
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
  if (!Object.keys(antennaPlacements).length) return
  if (!window.confirm('Remove all antenna pins from the map?')) return
  setAntennaPlacements({})
  setAntennaDirty(true)
 }, [antennaPlacements])

 const handleSaveAntennas = useCallback(async () => {
  setAntennaSaving(true)
  try {
   const saved = await apiPut('/api/antenna-placements', placementsToPayload(antennaPlacements))
   const normalized = normalizeAntennaPlacements(saved)
   setAntennaPlacements(normalized)
   antennaBaseline.current = normalized
   setAntennaDirty(false)
   setMessage('Antenna placements saved')
  } catch {
   setMessage('Could not save antenna placements')
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
    queueMicrotask(() => setSelectedStationId(nextUnplaced?.station ?? id))
   }
   return next
  })
  setStationDirty(true)
  if (opts.keepVisible) setSelectedStationId(id)
 }, [])

 const handleRemoveStation = useCallback((stationKey) => {
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
  if (!Object.keys(stationPlacements).length) return
  if (!window.confirm('Remove all station pins from the map?')) return
  setStationPlacements({})
  setStationDirty(true)
 }, [stationPlacements])

 const handleSaveStations = useCallback(async () => {
  setStationSaving(true)
  try {
   const saved = await apiPut('/api/station-placements', stationPlacementsToPayload(stationPlacements))
   const normalized = normalizeStationPlacements(saved)
   setStationPlacements(normalized)
   stationBaseline.current = normalized
   setStationDirty(false)
   setMessage('Station pins saved')
  } catch {
   setMessage('Could not save station pins')
  } finally {
   setStationSaving(false)
  }
 }, [stationPlacements])

 const antennaCount = useMemo(() => Object.keys(antennaPlacements).length, [antennaPlacements])
 const stationCount = useMemo(() => Object.keys(stationPlacements).length, [stationPlacements])

 return (
  <section className="bb-section">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <div>
     <h2 className="bb-section-title">Floor plan</h2>
     <p className="text-xs text-[#8b939e] mt-0.5">
      Place RFID antennas and station pins used on the Live Dashboard map.
      {' '}{antennaCount} antennas · {stationCount} stations placed
     </p>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
     <button
      type="button"
      onClick={antennaMode ? exitAntennaMode : enterAntennaMode}
      disabled={stationMode}
      className={`bb-btn-outline disabled:opacity-40 ${antennaMode ? 'bb-btn-outline-active' : ''}`}
     >
      <MapPin className="w-3 h-3" />
      {antennaMode ? 'Exit antennas' : 'Place antennas'}
     </button>
     <button
      type="button"
      onClick={stationMode ? exitStationMode : enterStationMode}
      disabled={antennaMode}
      className={`bb-btn-outline disabled:opacity-40 ${stationMode ? 'bb-btn-outline-active' : ''}`}
     >
      <UserRound className="w-3 h-3" />
      {stationMode ? 'Exit stations' : 'Place stations'}
     </button>
    </div>
   </div>

   {message && <p className="text-xs text-[#8b939e]">{message}</p>}

   <div className="bb-panel p-3 w-full relative">
    {antennaMode && (
     <AntennaPlaceToolbar
      antennas={antennas}
      selectedId={selectedAntennaId}
      onSelect={setSelectedAntennaId}
      placements={antennaPlacements}
      onRemove={handleRemoveAntenna}
      onRemoveAll={handleRemoveAllAntennas}
      onSave={handleSaveAntennas}
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
      onRemove={handleRemoveStation}
      onRemoveAll={handleRemoveAllStations}
      onSave={handleSaveStations}
      onCancel={exitStationMode}
      saving={stationSaving}
      dirty={stationDirty}
      showMarkers={showStationMarkers}
      onToggleShowMarkers={() => setShowStationMarkers(v => !v)}
     />
    )}
    <MemoFloorMap
     antennaMode={antennaMode}
     stationMode={stationMode}
     antennas={antennas}
     antennaPlacements={antennaPlacements}
     selectedAntennaId={selectedAntennaId}
     onPlaceAntenna={handlePlaceAntenna}
     onSelectAntenna={setSelectedAntennaId}
     onRemoveAntenna={handleRemoveAntenna}
     showAntennaMarkers={showAntennaMarkers}
     stations={PRODUCTION_LINE_STATIONS}
     stationPlacements={stationPlacements}
     selectedStationId={selectedStationId}
     onPlaceStation={handlePlaceStation}
     onSelectStation={setSelectedStationId}
     onRemoveStation={handleRemoveStation}
     showStationMarkers={showStationMarkers}
     mapRef={mapRef}
    />
    <p className="mt-2 text-[11px] text-[#8b939e]">
     {antennaMode
      ? 'Select an antenna, click the map to place it, then Save'
      : stationMode
       ? 'Select a machine, click the map to place its operator pin, then Save'
       : 'Use Place antennas / Place stations to edit pins for the live map'}
    </p>
   </div>
  </section>
 )
}
