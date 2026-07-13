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
  showPartBadge = true,
  onClick,
}) {
  const polygon = machine.polygon
  if (!Array.isArray(polygon) || polygon.length < 3) return null

  const points = pointsAttr(polygon)
  const centroid = polygonCentroid(polygon)
  const badgeParts = showPartBadge && partCount > 0
  const badgeOps = operatorCount > 0
  const badge = badgeParts || badgeOps

  let fill = 'rgba(56, 189, 248, 0.22)'
  let stroke = 'rgba(14, 165, 233, 0.9)'
  if (isEditTarget) {
    fill = 'rgba(14, 165, 233, 0.32)'
    stroke = 'rgba(56, 189, 248, 1)'
  } else if (isPinned) {
    fill = 'rgba(59, 130, 246, 0.28)'
    stroke = 'rgba(96, 165, 250, 1)'
  } else if (isActive) {
    fill = 'rgba(139, 92, 246, 0.32)'
    stroke = 'rgba(167, 139, 250, 1)'
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
        strokeWidth={isActive || isPinned || isEditTarget ? 2.5 : 2}
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
        <g transform={`translate(${centroid.x}, ${centroid.y - 10})`} className="pointer-events-none">
          {/* SVG-native badge stays tiny in viewBox space (foreignObject was scaling huge) */}
          <rect
            x={badgeParts && badgeOps ? -16 : -9}
            y={-5}
            width={badgeParts && badgeOps ? 32 : 18}
            height={10}
            rx={3}
            fill="#6d28d9"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="0.75"
          />
          <text
            y={2.2}
            textAnchor="middle"
            style={{ fontSize: 6, fontWeight: 700, fill: '#fff', letterSpacing: '0.02em' }}
          >
            {badgeParts && badgeOps
              ? `${partCount}p·${operatorCount}o`
              : badgeParts
                ? `${partCount}p`
                : `${operatorCount}op`}
          </text>
        </g>
      )}
      {(isActive || isEditTarget) && (
        <g transform={`translate(${centroid.x}, ${centroid.y + 8})`} className="pointer-events-none">
          <text
            y={0}
            textAnchor="middle"
            style={{ fontSize: 7, fontWeight: 700, fill: '#a78bfa', letterSpacing: '0.04em' }}
          >
            {machine.name}
          </text>
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
