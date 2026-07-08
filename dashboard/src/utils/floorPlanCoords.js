/**
 * Maps Sewio RTLS coordinates (meters) to floor-plan image pixels.
 *
 * Origin: Sewio (7, 2.5) → top-left corner of the white rectangle (CS Hood area).
 * +X = right, +Y = down (matches image / screen coordinates).
 *
 * Tune scale via VITE_FLOOR_PLAN_SCALE if markers don't align on the grid.
 */
export const FLOOR_PLAN = {
  imageWidth: 958,
  imageHeight: 575,
  originCoordX: 7,
  originCoordY: 2.5,
  originPixelX: 131,
  originPixelY: 81,
  scalePxPerM: Number(import.meta.env.VITE_FLOOR_PLAN_SCALE) || 18,
}

/** Sewio meters → pixel offsets from image top-left. */
export function sewioToPixel(x, y, cfg = FLOOR_PLAN) {
  const px = cfg.originPixelX + (x - cfg.originCoordX) * cfg.scalePxPerM
  const py = cfg.originPixelY + (y - cfg.originCoordY) * cfg.scalePxPerM
  return { px, py }
}

/** Sewio meters → CSS percentage for absolute positioning over a responsive image. */
export function sewioToPercent(x, y, cfg = FLOOR_PLAN) {
  const { px, py } = sewioToPixel(x, y, cfg)
  return {
    left: `${(px / cfg.imageWidth) * 100}%`,
    top: `${(py / cfg.imageHeight) * 100}%`,
  }
}

/** Sewio meters → CSS percentage, clamped to image edges. */
export function sewioToPercentClamped(x, y, cfg = FLOOR_PLAN) {
  const { px, py } = sewioToPixel(x, y, cfg)
  const cx = Math.max(0, Math.min(cfg.imageWidth, px))
  const cy = Math.max(0, Math.min(cfg.imageHeight, py))
  return {
    left: `${(cx / cfg.imageWidth) * 100}%`,
    top: `${(cy / cfg.imageHeight) * 100}%`,
    offMap: cx !== px || cy !== py,
  }
}
