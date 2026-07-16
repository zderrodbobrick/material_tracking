import { operatorsByStation, operatorsInMachineZone } from './machineRegions'
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

function earliestOperatorAt(zoneOps) {
  let best = null
  let bestMs = Infinity
  for (const op of zoneOps) {
    if (!op.at) continue
    const ms = new Date(op.at).getTime()
    if (!Number.isFinite(ms)) continue
    if (ms < bestMs) {
      bestMs = ms
      best = op.at
    }
  }
  return best
}

function primarySession(sessions) {
  if (sessions.length === 0) return null
  let best = sessions[0]
  let bestMs = Infinity
  for (const s of sessions) {
    const ms = s.entry_epoch_ms ?? (s.entry_time ? new Date(s.entry_time).getTime() : NaN)
    if (Number.isFinite(ms) && ms < bestMs) {
      bestMs = ms
      best = s
    }
  }
  return best
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
    return (
      session.part_number
      || session.part_name
      || parsed.ibusNumber
      || session.ibus_number
      || session.epc
      || '1 part'
    )
  }
  return `${sessions.length} parts`
}

/**
 * Station status for the machine status panel.
 * In use = part (open RFID session) AND operator (RTLS zone enter/exit).
 * Out of use = no part — separate color; operator still shown if present.
 */
export function getStationStatus(station, sessionsByStation, rtls, allStations, operatorsMap = null) {
  const sessions = sessionsForStation(sessionsByStation, station)
  const zoneOps = operatorsMap
    ? (operatorsMap.get(station.station) ?? [])
    : operatorsInMachineZone(rtls, station, allStations)
  const activeSessions = sessions.filter(s => s.status === 'open' || s.status === 'exit_only')

  const hasPart = activeSessions.length > 0
  const hasOperator = zoneOps.length > 0
  const operatorNames = collectOperatorNames(zoneOps)
  const operatorName = operatorNames.length > 0 ? operatorNames.join(', ') : null
  const partLabel = partLabelForSessions(activeSessions)
  const primary = primarySession(activeSessions)
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
    partEntryTime: primary?.entry_time ?? null,
    partEntryEpochMs: primary?.entry_epoch_ms ?? null,
    operatorEnteredAt: earliestOperatorAt(zoneOps),
    hasPart,
    hasOperator,
    light,
    inUse,
  }
}

export function getAllStationStatuses(allStations, stationOrder, sessionsByStation, rtls, operatorsMap = null) {
  const orderIndex = new Map(stationOrder.map((name, i) => [name, i]))
  const resolvedMap = operatorsMap ?? (rtls ? operatorsByStation(rtls, allStations) : new Map())

  return allStations
    .map(station => ({
      ...getStationStatus(station, sessionsByStation, rtls, allStations, resolvedMap),
      sortIndex: orderIndex.get(station.station) ?? orderIndex.get(station.name) ?? 999,
    }))
    .sort((a, b) => a.sortIndex - b.sortIndex)
}

/** @deprecated use getAllStationStatuses and filter by inUse */
export function getInUseStationStatuses(allStations, stationOrder, sessionsByStation, rtls) {
  return getAllStationStatuses(allStations, stationOrder, sessionsByStation, rtls)
    .filter(s => s.inUse)
}
