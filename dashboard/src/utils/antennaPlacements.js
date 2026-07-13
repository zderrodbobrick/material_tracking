/**
 * Antenna floor-plan placements and part-chip layout helpers.
 * Placements are image-pixel coords keyed by antenna_id (string).
 */

export function normalizeAntennaPlacements(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue
    const x = Number(val.x)
    const y = Number(val.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out[String(key)] = {
      x,
      y,
      visible: val.visible !== false,
    }
  }
  return out
}

export function placementsToPayload(map) {
  const out = {}
  for (const [key, val] of Object.entries(map)) {
    if (!val || !Number.isFinite(val.x) || !Number.isFinite(val.y)) continue
    out[String(key)] = {
      x: Math.round(val.x * 100) / 100,
      y: Math.round(val.y * 100) / 100,
      visible: val.visible !== false,
    }
  }
  return out
}

/** Full IBUS label for part lists, e.g. 1-D1-IBUS459302. */
export function partChipLabel(session, parseEpc) {
  const raw = session.epc ?? session.ibus_number ?? ''
  const parsed = parseEpc?.(raw) ?? {}
  if (parsed.ibusNumber) return parsed.ibusNumber
  if (session.ibus_number) return String(session.ibus_number)
  if (parsed.formatted) return parsed.formatted
  if (raw) return String(raw)
  return `#${session.session_id ?? session.id}`
}

/**
 * Fan chips around a point so multiple parts at one antenna don't stack.
 * Returns [{ session, x, y, label }]
 */
export function layoutPartChips(items, originX, originY, {
  maxFan = 6,
  radius = 18,
  startAngle = -Math.PI / 2,
} = {}) {
  if (!items.length) return []
  if (items.length === 1) {
    return [{ ...items[0], x: originX, y: originY - 10 }]
  }
  const n = Math.min(items.length, maxFan)
  const step = (Math.PI * 1.2) / Math.max(n - 1, 1)
  const start = startAngle - (Math.PI * 0.6)
  return items.map((item, i) => {
    if (i >= maxFan) {
      // Overflow stays on the origin with a count handled by caller
      return { ...item, x: originX, y: originY + 14, overflow: true }
    }
    const angle = start + step * i
    return {
      ...item,
      x: originX + Math.cos(angle) * radius,
      y: originY + Math.sin(angle) * radius,
      overflow: false,
    }
  })
}
