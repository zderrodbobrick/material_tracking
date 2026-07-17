import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, MapPin, Save, Trash2, X } from 'lucide-react'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { clientToImagePixel } from '../utils/machinePolygons'

function antennaLabel(ant) {
 if (!ant) return 'Antenna'
 const port = ant.antenna_port != null ? ant.antenna_port : '?'
 const name = ant.antenna_name || ant.antenna_role || `Port ${port}`
 return `#${port} ${name}`
}

/**
 * Floating, draggable toolbar so it does not block map placement clicks.
 */
export function AntennaPlaceToolbar({
 antennas,
 selectedId,
 onSelect,
 placements,
 onRemove,
 onRemoveAll,
 onSave,
 onCancel,
 saving,
 dirty,
 showMarkers,
 onToggleShowMarkers,
}) {
 const selected = antennas.find(a => String(a.antenna_id) === String(selectedId))
 const placed = selectedId != null ? placements[String(selectedId)] : null
 const placedList = antennas.filter(a => placements[String(a.antenna_id)])
 const unplacedList = antennas.filter(a => !placements[String(a.antenna_id)])

 const panelRef = useRef(null)
 const drag = useRef(null)
 const [offset, setOffset] = useState({ x: 12, y: 12 })
 const [collapsed, setCollapsed] = useState(false)

 const onGripDown = useCallback((e) => {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startY = e.clientY
  const orig = { ...offset }
  drag.current = { startX, startY, orig }
  e.currentTarget.setPointerCapture?.(e.pointerId)
 }, [offset])

 useEffect(() => {
  const onMove = (e) => {
   if (!drag.current) return
   const dx = e.clientX - drag.current.startX
   const dy = e.clientY - drag.current.startY
   setOffset({
    x: Math.max(4, drag.current.orig.x + dx),
    y: Math.max(4, drag.current.orig.y + dy),
   })
  }
  const onUp = () => { drag.current = null }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  return () => {
   window.removeEventListener('pointermove', onMove)
   window.removeEventListener('pointerup', onUp)
   window.removeEventListener('pointercancel', onUp)
  }
 }, [])

 return (
  <div
   ref={panelRef}
   className="absolute z-50 pointer-events-auto w-[min(22rem,calc(100%-1.5rem))]
 rounded-xl border border-[#fbbf24]/30/80 bg-[#18181d]/95 bg-[#08080a]/95
         border-[#fbbf24]/30 shadow-lg backdrop-blur-sm"
   style={{ left: offset.x, top: offset.y }}
  >
   <div
    className="flex items-center gap-1.5 px-2 py-1.5 border-b border-amber-100/80 border-[#fbbf24]/20
 cursor-grab active:cursor-grabbing select-none touch-none"
    onPointerDown={onGripDown}
    title="Drag to move this panel off the map"
   >
    <GripVertical className="w-3.5 h-3.5 text-amber-600/70 shrink-0" />
    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#fbbf24] flex-1">
     Edit antennas
    </span>
    <button
     type="button"
     onPointerDown={e => e.stopPropagation()}
     onClick={() => setCollapsed(c => !c)}
     className="p-1 rounded text-[#8b939e] hover:bg-[#fbbf24]/10 dark:hover:bg-[#fbbf24]/100/10"
     title={collapsed ? 'Expand' : 'Collapse'}
    >
     {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
    </button>
    <button
     type="button"
     onPointerDown={e => e.stopPropagation()}
     onClick={onSave}
     disabled={!dirty || saving}
     className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium
 bg-emerald-600 text-white disabled:opacity-40 hover:bg-[#34d399]/100"
    >
     <Save className="w-3 h-3" />
     {saving ? '…' : 'Save'}
    </button>
    <button
     type="button"
     onPointerDown={e => e.stopPropagation()}
     onClick={onCancel}
     className="p-1 rounded text-[#8b939e] hover:bg-[#4dc4f4]/10"
     title="Exit antenna edit"
    >
     <X className="w-3.5 h-3.5" />
    </button>
   </div>

   {!collapsed && (
    <div className="px-3 py-2.5 space-y-2">
     <div className="flex flex-wrap items-center gap-2">
      <select
       value={selectedId ?? ''}
       onChange={e => onSelect(e.target.value)}
       className="flex-1 min-w-[8rem] text-xs rounded-md border border-[#27272f] 
 bg-[#18181d] text-[#eef2f7] px-2 py-1"
      >
       {antennas.length === 0 && <option value="">No antennas in DB</option>}
       {antennas.map(a => {
        const id = String(a.antenna_id)
        const has = Boolean(placements[id])
        return (
         <option key={id} value={id}>
          {has ? '● ' : '○ '}
          {antennaLabel(a)}
          {a.station_name ? ` · ${a.station_name}` : ''}
         </option>
        )
       })}
      </select>
      <button
       type="button"
       onClick={onToggleShowMarkers}
       className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
 text-[#8b939e] dark:text-[#8b939e] border border-[#27272f] 
             hover:bg-[#4dc4f4]/5 hover:bg-[#4dc4f4]/10"
       title="Show or hide antenna pins on the live map (when not editing)"
      >
       {showMarkers ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      </button>
      <button
       type="button"
       onClick={() => onRemove(selectedId)}
       disabled={!placed}
       className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
 text-rose-600 border border-[#f87171]/30 border-[#f87171]/30
             disabled:opacity-40 hover:bg-[#f87171]/10 dark:hover:bg-[#f87171]/100/10"
       title="Remove selected antenna pin"
      >
       <Trash2 className="w-3 h-3" />
      </button>
      <button
       type="button"
       onClick={onRemoveAll}
       disabled={placedList.length === 0}
       className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
 text-rose-700 border border-rose-300 dark:border-rose-500/40
             disabled:opacity-40 hover:bg-[#f87171]/10 dark:hover:bg-[#f87171]/100/10"
       title="Remove all antenna pins"
      >
       Clear
      </button>
     </div>

     {placedList.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
       <span className="text-[10px] font-medium text-[#8b939e]">On map:</span>
       {placedList.map(a => {
        const id = String(a.antenna_id)
        const isSel = id === String(selectedId)
        return (
         <span
          key={id}
          className={`inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full text-[11px] font-medium border
           ${isSel
            ? 'bg-[#fbbf24]/10 text-[#fbbf24] border-amber-300 dark:bg-[#fbbf24]/100/15 dark:text-amber-200 dark:border-amber-500/40'
            : 'bg-[#08080a] text-[#8b939e] border-[#27272f] bg-[#18181d] dark:text-[#8b939e] '
           }`}
         >
          <button type="button" onClick={() => onSelect(id)} className="hover:underline">
           {antennaLabel(a)}
          </button>
          <button
           type="button"
           aria-label={`Remove ${antennaLabel(a)}`}
           onClick={() => onRemove(id)}
           className="inline-flex items-center justify-center w-4 h-4 rounded-full
 text-rose-500 hover:bg-rose-100 dark:hover:bg-[#f87171]/100/20"
          >
           <X className="w-3 h-3" />
          </button>
         </span>
        )
       })}
      </div>
     )}

     {unplacedList.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
       <span className="text-[10px] font-medium text-[#fbbf24]">
        Not placed ({unplacedList.length}):
       </span>
       {unplacedList.map(a => {
        const id = String(a.antenna_id)
        return (
         <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium border
           ${id === String(selectedId)
            ? 'bg-amber-100 text-[#fbbf24] border-amber-300 ring-1 ring-amber-400'
            : 'bg-[#18181d] text-[#8b939e] border-dashed border-amber-400 hover:bg-[#fbbf24]/10 bg-[#08080a] dark:border-amber-500/50'
           }`}
         >
          {antennaLabel(a)}
         </button>
        )
       })}
      </div>
     )}

     <p className="text-[11px] text-[#8b939e] flex items-start gap-1.5">
      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#fbbf24]" />
      <span>
       Drag this panel by the handle if it covers a machine.
       {selected
        ? placed
         ? ` ${antennaLabel(selected)} is placed — drag its pin or click the map to move it.`
         : ` Click the map to place ${antennaLabel(selected)}.`
        : ' Select an antenna, then click the map.'}
      </span>
     </p>
    </div>
   )}
  </div>
 )
}

/**
 * Full-map HTML layer: places/moves/removes antenna pins.
 */
export function AntennaPlaceLayer({
 mapRef,
 selectedId,
 placements,
 antennas,
 onPlace,
 onSelect,
 onRemove,
}) {
 const dragging = useRef(null)
 const moved = useRef(false)
 const layerRef = useRef(null)
 const [hover, setHover] = useState(null)

 const toPixel = useCallback((clientX, clientY) => {
  const el = layerRef.current || mapRef.current
  if (!el) return null
  return clientToImagePixel(clientX, clientY, el)
 }, [mapRef])

 const handleMapClick = useCallback((e) => {
  if (moved.current) {
   moved.current = false
   return
  }
  if (e.target?.closest?.('[data-antenna-pin]')) return
  if (!selectedId) return
  const pt = toPixel(e.clientX, e.clientY)
  if (pt) onPlace(String(selectedId), pt.x, pt.y)
 }, [onPlace, selectedId, toPixel])

 const handleMapMove = useCallback((e) => {
  const pt = toPixel(e.clientX, e.clientY)
  setHover(pt)
  if (dragging.current != null && pt) {
   moved.current = true
   onPlace(dragging.current, pt.x, pt.y, { keepVisible: true })
  }
 }, [onPlace, toPixel])

 useEffect(() => {
  const endDrag = () => {
   dragging.current = null
  }
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  return () => {
   window.removeEventListener('pointerup', endDrag)
   window.removeEventListener('pointercancel', endDrag)
  }
 }, [])

 const antById = Object.fromEntries(antennas.map(a => [String(a.antenna_id), a]))

 return (
  <div
   ref={layerRef}
   className="absolute inset-0 z-40 cursor-crosshair"
   onClick={handleMapClick}
   onPointerMove={handleMapMove}
   onPointerLeave={() => setHover(null)}
   style={{ background: 'rgba(15, 23, 42, 0.18)' }}
   title="Click to place or move the selected antenna"
  >
   {hover && selectedId && dragging.current == null && (
    <div
     className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full
 border-2 border-dashed border-amber-500 bg-amber-400/30 pointer-events-none"
     style={{
      left: `${(hover.x / FLOOR_PLAN.imageWidth) * 100}%`,
      top: `${(hover.y / FLOOR_PLAN.imageHeight) * 100}%`,
     }}
    />
   )}

   {Object.entries(placements).map(([id, p]) => {
    const ant = antById[id]
    const isSel = String(id) === String(selectedId)
    const label = `${(ant?.antenna_role || 'A').slice(0, 2)}${ant?.antenna_port ?? ''}`
    return (
     <div
      key={id}
      data-antenna-pin={id}
      className={`absolute z-10 ${isSel ? 'scale-110' : ''}`}
      style={{
       left: `${(p.x / FLOOR_PLAN.imageWidth) * 100}%`,
       top: `${(p.y / FLOOR_PLAN.imageHeight) * 100}%`,
      }}
     >
      <button
       type="button"
       title={`${antennaLabel(ant)} — drag to move`}
       className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2
 w-3.5 h-3.5 cursor-grab active:cursor-grabbing touch-none"
       onPointerDown={e => {
        e.preventDefault()
        e.stopPropagation()
        onSelect?.(id)
        dragging.current = id
        moved.current = false
        e.currentTarget.setPointerCapture?.(e.pointerId)
       }}
       onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        onSelect?.(id)
       }}
      >
       <span
        className={`block w-3.5 h-3.5 rounded-full border-2 shadow
         ${isSel
          ? 'bg-[#fbbf24]/100 border-amber-800 ring-2 ring-amber-300'
          : 'bg-[#18181d] border-amber-500'
         }`}
       />
      </button>
      <span
       className="absolute left-0 top-0 -translate-x-1/2 translate-y-2
 px-1 py-px rounded text-[8px] font-bold leading-none
             bg-amber-600 text-white whitespace-nowrap pointer-events-none"
      >
       {label}
      </span>
      <button
       type="button"
       aria-label={`Remove ${antennaLabel(ant)}`}
       title="Remove this antenna"
       className="absolute left-0 top-0 translate-x-2 -translate-y-3
 w-4 h-4 rounded-full bg-[#f87171]/100 text-white flex items-center justify-center
             shadow hover:bg-rose-600 border border-white/80"
       onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        onRemove?.(id)
       }}
      >
       <X className="w-2.5 h-2.5" />
      </button>
     </div>
    )
   })}
  </div>
 )
}

/** Non-edit antenna pins (when showMarkers is on). */
export function AntennaMarkers({ placements, antennas, showMarkers }) {
 if (!showMarkers) return null
 const antById = Object.fromEntries(antennas.map(a => [String(a.antenna_id), a]))
 return (
  <g className="antenna-markers pointer-events-none">
   {Object.entries(placements).map(([id, p]) => {
    if (p.visible === false) return null
    const ant = antById[id]
    return (
     <g key={id} transform={`translate(${p.x}, ${p.y})`} opacity={0.85}>
      <circle r={5} fill="#f59e0b" stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <text
       y={-8}
       textAnchor="middle"
       style={{ fontSize: 8, fontWeight: 600, fill: '#92400e' }}
      >
       {ant?.antenna_role === 'Exit' ? 'Ex' : 'En'}
       {ant?.antenna_port ?? ''}
      </text>
     </g>
    )
   })}
  </g>
 )
}
