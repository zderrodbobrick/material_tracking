import { operatorsInMachineZone } from './machineRegions'
import { parseEpc } from './parseEpc'

function collectOperatorNames(zoneOps) {
  const names = []
  const seen = new Set()
  for (const op of zoneOps) {
    const name = op.operator_name
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

export function sessionsForStation(sessionsByStation, station) {
  const keys = [station.station, ...(station.sessionAliases ?? [])]
  const out = []
  const seen = new Set()
  for (const key of keys) {
    for (const s of sessionsByStation[key] ?? []) {
      if (!seen.has(s.id ?? s.session_id)) {
        seen.add(s.id ?? s.session_id)
        out.push(s)
      }
    }
  }
  return out
}

function partLabelForSessions(sessions) {
  if (sessions.length === 0) return null
  if (sessions.length === 1) {
    const session = sessions[0]
    const parsed = parseEpc(session.epc ?? session.ibus_number)
    return parsed.ibusNumber ?? session.ibus_number ?? session.epc ?? '1 part'
  }
  return `${sessions.length} parts`
}

/**
 * Station status for the machine status panel.
 * In use = part (open RFID session) AND operator (polygon and/or RTLS zone).
 * Out of use = no part — separate color; operator still shown if present.
 */
export function getStationStatus(station, sessionsByStation, rtls, allStations) {
  const sessions = sessionsForStation(sessionsByStation, station)
  const zoneOps = operatorsInMachineZone(rtls, station, allStations)
  const activeSessions = sessions.filter(s => s.status === 'open' || s.status === 'exit_only')

  const hasPart = activeSessions.length > 0
  const hasOperator = zoneOps.length > 0
  const operatorNames = collectOperatorNames(zoneOps)
  const operatorName = operatorNames.length > 0 ? operatorNames.join(', ') : null
  const partLabel = partLabelForSessions(activeSessions)
  const inUse = hasPart && hasOperator

  let light = 'out'
  if (inUse) {
    light = 'green'
  } else if (hasPart && !hasOperator) {
    light = 'amber'
  }

  return {
    stationName: station.name,
    stationKey: station.station,
    operatorName,
    partLabel,
    partCount: activeSessions.length,
    hasPart,
    hasOperator,
    light,
    inUse,
  }
}

export function getAllStationStatuses(allStations, stationOrder, sessionsByStation, rtls) {
  const orderIndex = new Map(stationOrder.map((name, i) => [name, i]))

  return allStations
    .map(station => ({
      ...getStationStatus(station, sessionsByStation, rtls, allStations),
      sortIndex: orderIndex.get(station.station) ?? orderIndex.get(station.name) ?? 999,
    }))
    .sort((a, b) => a.sortIndex - b.sortIndex)
}

/** @deprecated use getAllStationStatuses and filter by inUse */
export function getInUseStationStatuses(allStations, stationOrder, sessionsByStation, rtls) {
  return getAllStationStatuses(allStations, stationOrder, sessionsByStation, rtls)
    .filter(s => s.inUse)
}
