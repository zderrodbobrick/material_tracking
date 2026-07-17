import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, MousePointerClick, Pencil, Trash2, Undo2, X } from 'lucide-react'
import { clientToImagePixel } from '../utils/machinePolygons'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { PRODUCTION_LINE_STATIONS } from '../utils/machineRegions'

const CLOSE_THRESHOLD_PX = 14

function pointsAttr(polygon) {
 return polygon.map(([x, y]) => `${x},${y}`).join(' ')
}

/**
 * Floating toolbar for drawing machine polygons on the floor plan.
 */
export function MachineShapeToolbar({
 draftPoints,
 selectedStation,
 onSelectStation,
 onCloseShape,
 onUndoPoint,
 onRemoveShape,
 onEditExisting,
 onCancel,
 onSave,
 saving,
 dirty,
 canRemove = false,
 shapedStations = [],
 onRemoveStation,
 stations = PRODUCTION_LINE_STATIONS,
}) {
 const hasSavedShape = canRemove
 const isDrawing = draftPoints.length > 0

 return (
  <div className="absolute inset-x-3 top-3 z-50 flex flex-col gap-2 pointer-events-none">
   <div
    className="pointer-events-auto mx-auto w-full max-w-xl rounded-xl border border-[#4dc4f4]/30/80
 bg-[#18181d]/95 bg-[#08080a]/95 border-[#4dc4f4]/30 shadow-lg backdrop-blur-sm
          px-3 py-2.5"
   >
    <div className="flex flex-wrap items-center gap-2">
     <span className="text-[10px] font-semibold uppercase tracking-wider text-[#4dc4f4]">
      Draw machine
     </span>
     <select
      value={selectedStation}
      onChange={e => onSelectStation(e.target.value)}
      className="flex-1 min-w-[8rem] text-xs rounded-md border border-[#27272f] 
 bg-[#18181d] text-[#eef2f7] px-2 py-1"
     >
      {stations.map(s => (
       <option key={s.station} value={s.station}>{s.name}</option>
      ))}
     </select>
     {hasSavedShape && !isDrawing && (
      <button
       type="button"
       onClick={onEditExisting}
       className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
 text-[#4dc4f4] border border-[#4dc4f4]/30 border-[#4dc4f4]/30
             hover:bg-[#4dc4f4]/10 dark:hover:bg-[#4dc4f4]/100/10"
       title="Load saved corners to adjust them"
      >
       <Pencil className="w-3 h-3" />
       Edit
      </button>
     )}
     <button
      type="button"
      onClick={onUndoPoint}
      disabled={!isDrawing}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
 text-[#8b939e] dark:text-[#8b939e] border border-[#27272f] 
            disabled:opacity-40 hover:bg-[#4dc4f4]/5 hover:bg-[#4dc4f4]/10"
      title="Undo last point"
     >
      <Undo2 className="w-3 h-3" />
      Undo
     </button>
     <button
      type="button"
      onClick={onRemoveShape}
      disabled={!hasSavedShape || saving}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
 text-rose-600 border border-[#f87171]/30 border-[#f87171]/30
            disabled:opacity-40 hover:bg-[#f87171]/10 dark:hover:bg-[#f87171]/100/10"
      title="Remove this machine's saved shape"
     >
      <Trash2 className="w-3 h-3" />
      Remove
     </button>
     <button
      type="button"
      onClick={onCloseShape}
      disabled={draftPoints.length < 3}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
 bg-sky-600 text-white disabled:opacity-40 hover:bg-[#4dc4f4]/100"
      title="Optional: close without snapping (or click the first corner)"
     >
      <Check className="w-3 h-3" />
      Done
     </button>
     <button
      type="button"
      onClick={onSave}
      disabled={!dirty || saving}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
 bg-emerald-600 text-white disabled:opacity-40 hover:bg-[#34d399]/100"
     >
      {saving ? 'Saving…' : 'Save'}
     </button>
     <button
      type="button"
      onClick={onCancel}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
 text-[#8b939e] hover:text-[#eef2f7] dark:hover:text-[#eef2f7]"
      title="Exit draw mode"
     >
      <X className="w-3.5 h-3.5" />
     </button>
    </div>
    {shapedStations.length > 0 && (
     <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-medium text-[#8b939e]">Saved:</span>
      {shapedStations.map(s => (
       <span
        key={s.station}
        className={`inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full text-[11px] font-medium
              border
         ${s.station === selectedStation
          ? 'bg-[#4dc4f4]/10 text-[#4dc4f4] border-sky-300 dark:bg-[#4dc4f4]/100/15 dark:border-sky-500/40'
          : 'bg-[#08080a] text-[#8b939e] border-[#27272f] bg-[#18181d] dark:text-[#8b939e] '
         }`}
       >
        <button
         type="button"
         onClick={() => onSelectStation(s.station)}
         className="hover:underline"
         title={`Select ${s.name}`}
        >
         {s.name}
        </button>
        <button
         type="button"
         aria-label={`Remove ${s.name} shape`}
         title={`Remove ${s.name}`}
         onClick={() => onRemoveStation?.(s.station)}
         disabled={saving}
         className="inline-flex items-center justify-center w-4 h-4 rounded-full
 text-rose-500 hover:bg-rose-100 dark:hover:bg-[#f87171]/100/20
               disabled:opacity-40"
        >
         <X className="w-3 h-3" />
        </button>
       </span>
      ))}
     </div>
    )}
    <p className="mt-1.5 text-[11px] text-[#8b939e] flex items-start gap-1.5">
     <MousePointerClick className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sky-500" />
     <span>
      {isDrawing
       ? `${draftPoints.length} corner${draftPoints.length !== 1 ? 's' : ''} — open path until you click back on the first (blue) corner to close.`
       : hasSavedShape
        ? 'Click the map to draw a new shape, or Edit to adjust corners.'
        : 'Click the floor plan to place corners as dots and lines — close by returning to the first corner.'}
     </span>
    </p>
   </div>
  </div>
 )
}

/**
 * HTML hit-layer for reliable point placement (SVG pointer events are unreliable).
 */
export function ShapeDraftLayer({
 draftPoints,
 onDraftChange,
 onCloseShape,
 mapRef,
}) {
 const dragging = useRef(null)
 const dragMoved = useRef(false)
 const layerRef = useRef(null)
 const [cursor, setCursor] = useState(null)

 const toPixel = useCallback((clientX, clientY) => {
  const el = layerRef.current || mapRef.current
  if (!el) return null
  return clientToImagePixel(clientX, clientY, el)
 }, [mapRef])

 const addOrClose = useCallback((pt) => {
  onDraftChange(prev => {
   if (
    prev.length >= 3 &&
    Math.hypot(pt.x - prev[0][0], pt.y - prev[0][1]) < CLOSE_THRESHOLD_PX
   ) {
    queueMicrotask(() => onCloseShape?.())
    return prev
   }
   return [...prev, [pt.x, pt.y]]
  })
 }, [onCloseShape, onDraftChange])

 const handleClick = useCallback((e) => {
  if (dragging.current != null) return
  if (e.target?.closest?.('[data-vertex-index]')) return
  const pt = toPixel(e.clientX, e.clientY)
  if (pt) addOrClose(pt)
 }, [addOrClose, toPixel])

 const handlePointerMove = useCallback((e) => {
  const pt = toPixel(e.clientX, e.clientY)
  if (!pt) return
  setCursor(pt)
  if (dragging.current != null) {
   dragMoved.current = true
   const idx = dragging.current
   onDraftChange(prev => prev.map((p, i) => (i === idx ? [pt.x, pt.y] : p)))
  }
 }, [onDraftChange, toPixel])

 useEffect(() => {
  const endDrag = () => { dragging.current = null }
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  return () => {
   window.removeEventListener('pointerup', endDrag)
   window.removeEventListener('pointercancel', endDrag)
  }
 }, [])

 useEffect(() => {
  const onKey = (e) => {
   if (e.key === 'Enter' && draftPoints.length >= 3) onCloseShape?.()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
 }, [draftPoints.length, onCloseShape])

 // Open path only — never auto-close to the first point until the user snaps back.
 const openPath =
  draftPoints.length > 0 && cursor && dragging.current == null && !nearFirstHint(draftPoints, cursor)
   ? [...draftPoints, [cursor.x, cursor.y]]
   : draftPoints

 const nearFirst = nearFirstHint(draftPoints, cursor)

 // Closing preview: rubber-band last → first when cursor is near the first corner.
 const closePreview =
  nearFirst && draftPoints.length >= 3
   ? [...draftPoints, draftPoints[0]]
   : null

 const pct = (x, y) => ({
  left: `${(x / FLOOR_PLAN.imageWidth) * 100}%`,
  top: `${(y / FLOOR_PLAN.imageHeight) * 100}%`,
 })

 return (
  <div
   ref={layerRef}
   className="absolute inset-0 z-40 cursor-crosshair"
   onClick={handleClick}
   onPointerMove={handlePointerMove}
   onPointerLeave={() => setCursor(null)}
   style={{ background: 'rgba(15, 23, 42, 0.14)' }}
  >
   <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    viewBox={`0 0 ${FLOOR_PLAN.imageWidth} ${FLOOR_PLAN.imageHeight}`}
    preserveAspectRatio="none"
   >
    {openPath.length >= 2 && (
     <polyline
      points={pointsAttr(openPath)}
      fill="none"
      stroke="rgba(14, 165, 233, 0.9)"
      strokeWidth="2"
      strokeDasharray="6 4"
      vectorEffect="non-scaling-stroke"
     />
    )}
    {closePreview && (
     <>
      <polygon
       points={pointsAttr(draftPoints)}
       fill="rgba(14, 165, 233, 0.18)"
       stroke="none"
      />
      <polyline
       points={pointsAttr(closePreview)}
       fill="none"
       stroke="rgba(14, 165, 233, 0.95)"
       strokeWidth="2.5"
       vectorEffect="non-scaling-stroke"
      />
     </>
    )}
   </svg>

   {draftPoints.map(([x, y], i) => {
    const isFirst = i === 0
    const canCloseOnFirst = isFirst && draftPoints.length >= 3
    const size = isFirst && nearFirst ? 18 : 12
    return (
     <button
      key={i}
      type="button"
      data-vertex-index={i}
      title={
       canCloseOnFirst
        ? 'Click to close the region (drag to move)'
        : isFirst
         ? 'First corner — return here to close'
         : `Corner ${i + 1}`
      }
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2
 cursor-grab active:cursor-grabbing touch-none shadow"
      style={{
       ...pct(x, y),
       width: size,
       height: size,
       background: isFirst ? '#0ea5e9' : '#fff',
       borderColor: isFirst ? '#0369a1' : '#0ea5e9',
       boxShadow: isFirst && nearFirst ? '0 0 0 3px rgba(14,165,233,0.45)' : undefined,
      }}
      onPointerDown={e => {
       e.preventDefault()
       e.stopPropagation()
       dragMoved.current = false
       dragging.current = i
       e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      onClick={e => {
       e.preventDefault()
       e.stopPropagation()
       if (canCloseOnFirst && !dragMoved.current) onCloseShape?.()
      }}
     />
    )
   })}
  </div>
 )
}

function nearFirstHint(draftPoints, cursor) {
 if (!cursor || draftPoints.length < 3) return false
 return Math.hypot(cursor.x - draftPoints[0][0], cursor.y - draftPoints[0][1]) < CLOSE_THRESHOLD_PX
}
