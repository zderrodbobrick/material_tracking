import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { polygonCentroid } from '../utils/machinePolygons'

function pointsAttr(polygon) {
  return polygon.map(([x, y]) => `${x},${y}`).join(' ')
}

export function MachineOverlay({
  machine,
  partCount,
  operatorCount,
  isActive,
  isPinned,
  editMode = false,
  isEditTarget = false,
  onClick,
}) {
  const polygon = machine.polygon
  if (!Array.isArray(polygon) || polygon.length < 3) return null

  const points = pointsAttr(polygon)
  const centroid = polygonCentroid(polygon)
  const badge = partCount > 0 || operatorCount > 0

  let fill = 'rgba(139, 92, 246, 0.08)'
  let stroke = 'rgba(139, 92, 246, 0.35)'
  if (isEditTarget) {
    fill = 'rgba(14, 165, 233, 0.2)'
    stroke = 'rgba(14, 165, 233, 0.95)'
  } else if (isPinned) {
    fill = 'rgba(59, 130, 246, 0.2)'
    stroke = 'rgba(96, 165, 250, 0.95)'
  } else if (isActive) {
    fill = 'rgba(139, 92, 246, 0.22)'
    stroke = 'rgba(167, 139, 250, 0.95)'
  }

  const handleActivate = (e) => {
    if (editMode) return
    e.stopPropagation()
    onClick?.(e)
  }

  return (
    <g className="machine-overlay">
      <polygon
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth={isActive || isPinned || isEditTarget ? 2.5 : 1.5}
        vectorEffect="non-scaling-stroke"
        className={editMode ? 'pointer-events-none' : 'cursor-pointer hover:opacity-90'}
        style={{
          filter: isPinned || isActive
            ? 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.35))'
            : undefined,
          transition: 'fill 150ms, stroke 150ms',
        }}
        onClick={handleActivate}
        role={editMode ? undefined : 'button'}
        tabIndex={editMode ? undefined : 0}
        aria-label={`${machine.name} — ${partCount} part${partCount !== 1 ? 's' : ''}, ${operatorCount} operator${operatorCount !== 1 ? 's' : ''}${isPinned ? ', queue pinned' : ''}`}
        onKeyDown={editMode ? undefined : (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleActivate(e)
          }
        }}
      />
      {badge && (
        <g transform={`translate(${centroid.x}, ${centroid.y - 14})`} className="pointer-events-none">
          <foreignObject x={-60} y={-12} width={120} height={24}>
            <div xmlns="http://www.w3.org/1999/xhtml" className="flex justify-center">
              <span
                className="whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold
                           bg-violet-600 text-white shadow-md border border-violet-400/50"
              >
                {partCount > 0 && `${partCount} part${partCount !== 1 ? 's' : ''}`}
                {partCount > 0 && operatorCount > 0 && ' · '}
                {operatorCount > 0 && `${operatorCount} op${operatorCount !== 1 ? 's' : ''}`}
              </span>
            </div>
          </foreignObject>
        </g>
      )}
      {(isActive || isEditTarget) && (
        <g transform={`translate(${centroid.x}, ${centroid.y + 8})`} className="pointer-events-none">
          <foreignObject x={-70} y={0} width={140} height={20}>
            <div xmlns="http://www.w3.org/1999/xhtml" className="flex justify-center">
              <span
                className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider
                           px-1.5 py-0.5 rounded bg-violet-600/90 text-white"
              >
                {machine.name}
              </span>
            </div>
          </foreignObject>
        </g>
      )}
    </g>
  )
}

export function MachineOverlaySvg({ children, className = '' }) {
  return (
    <svg
      className={`absolute inset-0 w-full h-full ${className}`}
      viewBox={`0 0 ${FLOOR_PLAN.imageWidth} ${FLOOR_PLAN.imageHeight}`}
      preserveAspectRatio="none"
    >
      {children}
    </svg>
  )
}
