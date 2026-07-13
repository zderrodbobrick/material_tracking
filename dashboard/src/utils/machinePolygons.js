import { FLOOR_PLAN, sewioToPixel } from './floorPlanCoords'

/** Ray-casting point-in-polygon. polygon = [[x,y], ...] in the same space as px/py. */
export function pointInPolygon(px, py, polygon) {
  if (!polygon || polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Axis-aligned rect → closed polygon ring (image pixels). */
export function rectToPolygon({ x, y, w, h }) {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
}

export function polygonCentroid(polygon) {
  if (!polygon?.length) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const [x, y] of polygon) {
    sx += x
    sy += y
  }
  return { x: sx / polygon.length, y: sy / polygon.length }
}

export function polygonToSvgPoints(polygon, cfg = FLOOR_PLAN) {
  return polygon
    .map(([x, y]) => `${(x / cfg.imageWidth) * 100},${(y / cfg.imageHeight) * 100}`)
    .join(' ')
}

/** Client click on the floor-plan element → image pixel coords. */
export function clientToImagePixel(clientX, clientY, element, cfg = FLOOR_PLAN) {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = ((clientX - rect.left) / rect.width) * cfg.imageWidth
  const y = ((clientY - rect.top) / rect.height) * cfg.imageHeight
  return {
    x: Math.max(0, Math.min(cfg.imageWidth, x)),
    y: Math.max(0, Math.min(cfg.imageHeight, y)),
  }
}

/** Sewio meters → true if inside machine polygon (image pixels). */
export function sewioInsidePolygon(sewioX, sewioY, polygon, cfg = FLOOR_PLAN) {
  if (sewioX == null || sewioY == null || !polygon?.length) return false
  const { px, py } = sewioToPixel(sewioX, sewioY, cfg)
  return pointInPolygon(px, py, polygon)
}

export function normalizeShapesMap(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [station, shape] of Object.entries(raw)) {
    const poly = shape?.polygon
    if (!Array.isArray(poly) || poly.length < 3) continue
    const points = poly
      .map(pt => {
        if (Array.isArray(pt) && pt.length >= 2) return [Number(pt[0]), Number(pt[1])]
        if (pt && typeof pt === 'object') return [Number(pt.x), Number(pt.y)]
        return null
      })
      .filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (points.length >= 3) out[station] = { polygon: points }
  }
  return out
}
