/**
 * Maps Sewio RTLS coordinates (meters) to floor-plan image pixels.
 *
 * Calibrate via VITE_FLOOR_PLAN_* in the project-root .env, then:
 *   cd dashboard && npm run build
 * Hard-refresh the browser (Ctrl+Shift+R).
 *
 * Formula:
 *   pixelX = originPixelX + (sewioX - originCoordX) * scale
 *   pixelY = originPixelY + (sewioY - originCoordY) * scale
 *
 * +X = right, +Y = down.
 */
function envNum(name, fallback) {
  const raw = import.meta.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export const FLOOR_PLAN = {
  imageWidth: 958,
  imageHeight: 575,
  originCoordX: envNum('VITE_FLOOR_PLAN_ORIGIN_X', 12),
  originCoordY: envNum('VITE_FLOOR_PLAN_ORIGIN_Y', 8.5),
  originPixelX: envNum('VITE_FLOOR_PLAN_PIXEL_X', 131),
  originPixelY: envNum('VITE_FLOOR_PLAN_PIXEL_Y', 81),
  scalePxPerM: envNum('VITE_FLOOR_PLAN_SCALE', 18),
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
