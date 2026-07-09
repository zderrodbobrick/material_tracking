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

function displayName(zoneIds) {
  const zid = zoneIds[0]
  const raw = zoneNames[String(zid)]
  if (!raw) return `Zone ${zid}`
  return raw.replace(/^BLA-/, '')
}

/** Optional floor-plan overlays and RFID session aliases keyed by station name. */
const STATION_EXTRAS = {
  Gannomat: {
    pixelBounds: { x: 390, y: 170, w: 35, h: 90 },
  },
  'Insert Station': {
    pixelBounds: { x: 370, y: 235, w: 20, h: 20 },
  },
  'Pack out': {
    sessionAliases: ['Final Packing', 'Pack out'],
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
      name: displayName(sortedZoneIds),
      station,
      zoneIds: sortedZoneIds,
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
  'Component Stacking',
  'Outswing Latch Drilling',
  'Tenoner',
  'Gannomat',
  'Insert Station',
  'Evolve Drilling',
  'Inspect',
  'Anderson',
  'Pack out',
  'Packing',
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

/** Stations with floor-plan hit targets (subset of ALL_STATIONS). */
export const MACHINES = ALL_STATIONS.filter(s => s.pixelBounds)

/** Stations available to pin on the live dashboard (RFID queue panels). */
export const PINNABLE_STATIONS = [
  'Holzma',
  'Holzma.Falloff',
  'LBD',
  'Tenoner',
  'Gannomat',
  'Insert Station',
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

function operatorRecord(z, pos) {
  return {
    tag_id: z.tag_id,
    zone_id: z.zone_id,
    zone_name: z.zone_name,
    station_name: z.station_name ?? null,
    operator_name: z.operator_name ?? pos?.operator_name ?? `Tag ${z.tag_id}`,
    x: pos?.x,
    y: pos?.y,
    at: z.at ?? pos?.at,
    zone_display: pos?.zone_display ?? null,
  }
}

/**
 * Assign operators to stations using Sewio zone_presence (same source as rtls_viewer).
 * Each tag appears at most once, keyed by zone enter/exit + REST bootstrap.
 */
export function operatorsByStation(rtls, stations = ALL_STATIONS) {
  const byStation = new Map(stations.map(s => [s.station, []]))
  if (!rtls) return byStation

  const posByTag = new Map((rtls.positions ?? []).map(p => [p.tag_id, p]))
  const assigned = new Set()

  for (const z of rtls.zone_presence ?? []) {
    if (z.status !== 'in') continue
    const station = stationForZonePresence(z, stations)
    if (!station || assigned.has(z.tag_id)) continue
    assigned.add(z.tag_id)
    const list = byStation.get(station.station) ?? []
    list.push(operatorRecord(z, posByTag.get(z.tag_id)))
    byStation.set(station.station, list)
  }

  return byStation
}

/** Pixel rect → CSS % for responsive overlay positioning. */
export function machineBoundsToPercent(machine, cfg = FLOOR_PLAN) {
  const { x, y, w, h } = machine.pixelBounds
  return {
    left: `${(x / cfg.imageWidth) * 100}%`,
    top: `${(y / cfg.imageHeight) * 100}%`,
    width: `${(w / cfg.imageWidth) * 100}%`,
    height: `${(h / cfg.imageHeight) * 100}%`,
  }
}

export function operatorsInMachineZone(rtls, machine) {
  return operatorsByStation(rtls).get(machine.station) ?? []
}
