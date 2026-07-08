import { FLOOR_PLAN } from './floorPlanCoords'

/**
 * Clickable machine regions on floor_plan.png (958×575).
 * Calibrate pixelBounds if the hit target feels off — same workflow as floor plan RTLS dots.
 */
export const MACHINES = [
  {
    id: 'gannomat',
    name: 'Gannomat',
    station: 'Gannomat',
    zoneIds: [7],
    pixelBounds: { x: 390, y: 170, w: 40, h: 90 },
  },
]

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
  if (!rtls) return []
  const zoneIds = new Set(machine.zoneIds ?? [])
  const station = machine.station?.toLowerCase()
  const posByTag = new Map((rtls.positions ?? []).map(p => [p.tag_id, p]))

  return (rtls.zone_presence ?? [])
    .filter(z => {
      if (z.status !== 'in') return false
      if (zoneIds.has(z.zone_id)) return true
      const zname = (z.zone_name ?? '').toLowerCase()
      return station && zname.includes(station)
    })
    .map(z => {
      const pos = posByTag.get(z.tag_id)
      return {
        tag_id: z.tag_id,
        zone_id: z.zone_id,
        zone_name: z.zone_name,
        operator_name: pos?.operator_name ?? `Tag ${z.tag_id}`,
        x: pos?.x,
        y: pos?.y,
      }
    })
}
