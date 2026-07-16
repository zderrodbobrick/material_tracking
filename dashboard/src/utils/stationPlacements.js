/**
 * Station floor-plan pins for operator markers.
 * Placements are image-pixel coords keyed by station name (e.g. "Gannomat").
 */

export function normalizeStationPlacements(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue
    const station = String(key).trim()
    if (!station) continue
    const x = Number(val.x)
    const y = Number(val.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out[station] = {
      x,
      y,
      visible: val.visible !== false,
    }
  }
  return out
}

export function stationPlacementsToPayload(map) {
  const out = {}
  for (const [key, val] of Object.entries(map)) {
    if (!val || !Number.isFinite(val.x) || !Number.isFinite(val.y)) continue
    const station = String(key).trim()
    if (!station) continue
    out[station] = {
      x: Math.round(val.x * 100) / 100,
      y: Math.round(val.y * 100) / 100,
      visible: val.visible !== false,
    }
  }
  return out
}
