import { FLOOR_PLAN } from './floorPlanCoords'
import zoneMappings from '../../../RTLS/zoneMappings.json'
import zoneNames from '../../../RTLS/zoneNames.json'

/** TPF.Gannomat -> Gannomat (matches tracking/rtls_lookup.mes_to_station). */
function mesToStation(mes) {
  const loc = String(mes).trim()
  const dot = loc.indexOf('.')
  return dot === -1 ? loc : loc.slice(dot + 1)
}

function slugify(station) {
  return station.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'station'
}

/** Short labels for filter chips / status table (station key → UI text). */
const CHIP_LABELS = {
  Holzma: 'Holzma',
  'Holzma.Falloff': 'Holzma Falloff',
  LBD: 'LBD',
  'LB Installation': 'LB Install',
  '1/2 Edgefinisher': 'Edgefinisher',
  Tenoner: 'Tenoner',
  Gannomat: 'Gannomat',
  'Insert Station': 'Insert',
  'Evolve Edge Finisher': 'Evolve Edge Finisher',
  'Evolve Drilling': 'Evolve Drilling',
  Inspect: 'Inspect',
  Anderson: 'Anderson',
  'Pack out': 'Pack out',
}

/** Strip Sewio site prefixes: BLA-CL-Gannomat → Gannomat */
function displayName(zoneIds, station) {
  if (CHIP_LABELS[station]) return CHIP_LABELS[station]
  const zid = zoneIds[0]
  const raw = zoneNames[String(zid)]
  if (!raw) return station || `Zone ${zid}`
  return String(raw)
    .replace(/^BLA-/i, '')
    .replace(/^CL-/i, '')
    .replace(/^Hardware-/i, '')
    .replace(/^TP-/i, '')
    .trim() || station
}

/** Optional RFID session aliases keyed by station name. */
const STATION_EXTRAS = {
  'LB Installation': {
    // Outswing Latch Drilling is the same workstation as LB Install
    sessionAliases: ['LB Installation', 'Outswing Latch Drilling'],
  },
  'Pack out': {
    sessionAliases: ['Final Packing', 'Pack out', 'Packing'],
  },
}

function buildAllStations() {
  const byStation = new Map()

  for (const [zidStr, mes] of Object.entries(zoneMappings)) {
    if (String(zidStr).startsWith('_')) continue
    const zid = Number(zidStr)
    if (!Number.isFinite(zid)) continue
    const station = mesToStation(mes)
    if (!byStation.has(station)) {
      byStation.set(station, [])
    }
    byStation.get(station).push(zid)
  }

  return [...byStation.entries()].map(([station, zoneIds]) => {
    const sortedZoneIds = [...zoneIds].sort((a, b) => a - b)
    return {
      id: slugify(station),
      name: displayName(sortedZoneIds, station),
      station,
      zoneIds: sortedZoneIds,
      polygon: null,
      ...STATION_EXTRAS[station],
    }
  })
}

/** CL production workstations — shown on machine status panel and filter chips. */
export const PRODUCTION_LINE_ORDER = [
  'Holzma',
  'Holzma.Falloff',
  'LBD',
  'LB Installation',
  '1/2 Edgefinisher',
  'Tenoner',
  'Gannomat',
  'Insert Station',
  'Evolve Edge Finisher',
  'Evolve Drilling',
  'Inspect',
  'Anderson',
  'Pack out',
]

/** Full sort order including non-production RTLS zones (queues, debugging). */
export const STATION_ORDER = [
  ...PRODUCTION_LINE_ORDER,
  'CL',
  'Hardware.VLM All',
  'Hardware.VLM Pack',
  'Hardware.VLM Pick',
  'Hardware.VLM Desk',
  'Hardware.Long Hardware',
  'Hardware.VLM All (1)',
  'Hardware.VLM All (2)',
  'TP Shipping',
  'TP Tags Storage',
  'TP Forklifts Aisle',
  '10',
  '3',
  '1',
]

/** Sewio zone_id -> line station (derived from RTLS/zoneMappings.json). */
export const ALL_STATIONS = buildAllStations()

/** Production CL machines only (excludes hardware/VLM, TP, and generic CL zone). */
export const PRODUCTION_LINE_STATIONS = ALL_STATIONS.filter(s =>
  PRODUCTION_LINE_ORDER.includes(s.station),
)

/**
 * Merge saved floor-plan polygons onto station configs.
 * Stations with a polygon become map hit targets.
 * Pass null polygon entries are ignored; missing keys leave polygon null.
 */
export function applyMachineShapes(stations, shapesMap) {
  return stations.map(station => {
    const saved = shapesMap?.[station.station]?.polygon
    if (Array.isArray(saved) && saved.length >= 3) {
      return { ...station, polygon: saved.map(([x, y]) => [x, y]) }
    }
    return { ...station, polygon: null }
  })
}

/** Stations with a drawable / clickable floor-plan polygon. */
export function machinesWithPolygons(stations = ALL_STATIONS) {
  return stations.filter(s => Array.isArray(s.polygon) && s.polygon.length >= 3)
}

/** @deprecated prefer machinesWithPolygons after shapes load */
export const MACHINES = machinesWithPolygons(ALL_STATIONS)

/** Stations available to pin on the live dashboard (RFID queue panels). */
export const PINNABLE_STATIONS = [
  'Holzma',
  'Holzma.Falloff',
  'LBD',
  'Tenoner',
  'Gannomat',
  'Insert Station',
  'Evolve Edge Finisher',
  'Evolve Drilling',
  'Inspect',
  'Anderson',
  'Pack out',
]

/** zone_id -> station config (same mapping rtls_viewer uses via zoneMappings.json). */
export function buildZoneIdMap(stations = ALL_STATIONS) {
  const map = new Map()
  for (const station of stations) {
    for (const zoneId of station.zoneIds ?? []) {
      map.set(Number(zoneId), station)
    }
  }
  return map
}

const ZONE_ID_MAP = buildZoneIdMap()

/** Resolve line station from Sewio zone id (authoritative — matches rtls_viewer). */
export function stationForZone(zoneId, stations = ALL_STATIONS) {
  const id = Number(zoneId)
  if (!Number.isFinite(id)) return null
  const map = stations === ALL_STATIONS ? ZONE_ID_MAP : buildZoneIdMap(stations)
  return map.get(id) ?? null
}

function stationForZonePresence(z, stations = ALL_STATIONS) {
  const byId = stationForZone(z.zone_id, stations)
  if (byId) return byId
  if (!z.station_name) return null
  return stations.find(s => s.station === z.station_name) ?? null
}

function operatorRecord(z) {
  return {
    tag_id: z.tag_id,
    zone_id: z.zone_id ?? null,
    zone_name: z.zone_name ?? null,
    station_name: z.station_name ?? null,
    operator_name: z.operator_name ?? `Tag ${z.tag_id}`,
    at: z.at ?? null,
    presence_source: 'zone',
  }
}

/**
 * Assign operators to stations from Sewio zone enter/exit only.
 * Live XY is not used — keeps the dashboard light and lag-free.
 */
export function operatorsByStation(rtls, stations = ALL_STATIONS) {
  const byStation = new Map(stations.map(s => [s.station, []]))
  if (!rtls) return byStation

  const assigned = new Set()
  for (const z of rtls.zone_presence ?? []) {
    if (z.status !== 'in' || assigned.has(z.tag_id)) continue
    const station = stationForZonePresence(z, stations)
    if (!station) continue
    assigned.add(z.tag_id)
    const list = byStation.get(station.station) ?? []
    list.push(operatorRecord(z))
    byStation.set(station.station, list)
  }

  return byStation
}

/** Pixel rect → CSS % for responsive overlay positioning (legacy). */
export function machineBoundsToPercent(machine, cfg = FLOOR_PLAN) {
  const bounds = machine.pixelBounds
  if (!bounds && machine.polygon?.length) {
    const xs = machine.polygon.map(p => p[0])
    const ys = machine.polygon.map(p => p[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const w = Math.max(...xs) - x
    const h = Math.max(...ys) - y
    return {
      left: `${(x / cfg.imageWidth) * 100}%`,
      top: `${(y / cfg.imageHeight) * 100}%`,
      width: `${(w / cfg.imageWidth) * 100}%`,
      height: `${(h / cfg.imageHeight) * 100}%`,
    }
  }
  const { x, y, w, h } = bounds
  return {
    left: `${(x / cfg.imageWidth) * 100}%`,
    top: `${(y / cfg.imageHeight) * 100}%`,
    width: `${(w / cfg.imageWidth) * 100}%`,
    height: `${(h / cfg.imageHeight) * 100}%`,
  }
}

export function operatorsInMachineZone(rtls, machine, stations = ALL_STATIONS) {
  const list = stations.map(s =>
    s.station === machine.station
      ? { ...s, polygon: machine.polygon ?? s.polygon }
      : s,
  )
  return operatorsByStation(rtls, list).get(machine.station) ?? []
}
