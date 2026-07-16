import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Save, Trash2, UserRound, X } from 'lucide-react'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { clientToImagePixel } from '../utils/machinePolygons'

/**
 * Floating, draggable toolbar for station pins (same pattern as antennas).
 */
export function StationPlaceToolbar({
  stations,
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
  const selected = stations.find(s => s.station === selectedId)
  const placed = selectedId != null ? placements[selectedId] : null
  const placedList = stations.filter(s => placements[s.station])
  const unplacedList = stations.filter(s => !placements[s.station])

  const drag = useRef(null)
  const [offset, setOffset] = useState({ x: 12, y: 12 })
  const [collapsed, setCollapsed] = useState(false)

  const onGripDown = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { startX: e.clientX, startY: e.clientY, orig: { ...offset } }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [offset])

  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return
      setOffset({
        x: Math.max(4, drag.current.orig.x + (e.clientX - drag.current.startX)),
        y: Math.max(4, drag.current.orig.y + (e.clientY - drag.current.startY)),
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
      className="absolute z-50 pointer-events-auto w-[min(22rem,calc(100%-1.5rem))]
                 rounded-xl border border-sky-200/80 bg-white/95 dark:bg-slate-900/95
                 dark:border-sky-500/30 shadow-lg backdrop-blur-sm"
      style={{ left: offset.x, top: offset.y }}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 border-b border-sky-100/80 dark:border-sky-500/20
                   cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={onGripDown}
        title="Drag to move this panel off the map"
      >
        <GripVertical className="w-3.5 h-3.5 text-sky-600/70 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-400 flex-1">
          Edit stations
        </span>
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setCollapsed(c => !c)}
          className="p-1 rounded text-gray-500 hover:bg-sky-50 dark:hover:bg-sky-500/10"
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
                     bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-500"
        >
          <Save className="w-3 h-3" />
          {saving ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={onCancel}
          className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
          title="Exit station edit"
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
              className="flex-1 min-w-[8rem] text-xs rounded-md border border-gray-200 dark:border-slate-600
                         bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-100 px-2 py-1"
            >
              {stations.length === 0 && <option value="">No stations</option>}
              {stations.map(s => {
                const has = Boolean(placements[s.station])
                return (
                  <option key={s.station} value={s.station}>
                    {has ? '● ' : '○ '}
                    {s.name}
                  </option>
                )
              })}
            </select>
            <button
              type="button"
              onClick={onToggleShowMarkers}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
                         text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-600
                         hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              {showMarkers ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={() => onRemove(selectedId)}
              disabled={!placed}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
                         text-rose-600 border border-rose-200 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onRemoveAll}
              disabled={placedList.length === 0}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
                         text-rose-700 border border-rose-300 disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          {placedList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium text-gray-400">On map:</span>
              {placedList.map(s => {
                const isSel = s.station === selectedId
                return (
                  <span
                    key={s.station}
                    className={`inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full text-[11px] font-medium border
                      ${isSel
                        ? 'bg-sky-50 text-sky-800 border-sky-300'
                        : 'bg-gray-50 text-gray-600 border-gray-200'
                      }`}
                  >
                    <button type="button" onClick={() => onSelect(s.station)} className="hover:underline">
                      {s.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(s.station)}
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-rose-500"
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
              <span className="text-[10px] font-medium text-sky-700">Not placed ({unplacedList.length}):</span>
              {unplacedList.map(s => (
                <button
                  key={s.station}
                  type="button"
                  onClick={() => onSelect(s.station)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border
                    ${s.station === selectedId
                      ? 'bg-sky-100 text-sky-800 border-sky-300'
                      : 'bg-white text-gray-600 border-dashed border-sky-400'
                    }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <p className="text-[11px] text-gray-500 flex items-start gap-1.5">
            <UserRound className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sky-500" />
            <span>
              Drag this panel by the handle if it covers a machine.
              {selected
                ? placed
                  ? ` ${selected.name} is placed — drag its pin or click the map to move it.`
                  : ` Click the map to place ${selected.name}.`
                : ' Select a station, then click the map.'}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Full-map HTML layer for placing / moving / removing station pins.
 */
export function StationPlaceLayer({
  mapRef,
  selectedId,
  placements,
  stations,
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
    if (dragging.current != null) return
    if (e.target?.closest?.('[data-station-pin]')) return
    if (!selectedId) return
    const pt = toPixel(e.clientX, e.clientY)
    if (pt) onPlace(selectedId, pt.x, pt.y)
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
      moved.current = false
    }
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [])

  const stationByKey = Object.fromEntries(stations.map(s => [s.station, s]))

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 z-40 cursor-crosshair"
      onClick={handleMapClick}
      onPointerMove={handleMapMove}
      onPointerLeave={() => setHover(null)}
      style={{ background: 'rgba(15, 23, 42, 0.18)' }}
      title="Click to place or move the selected station pin"
    >
      {hover && selectedId && dragging.current == null && (
        <div
          className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full
                     border-2 border-dashed border-sky-500 bg-sky-400/30 pointer-events-none"
          style={{
            left: `${(hover.x / FLOOR_PLAN.imageWidth) * 100}%`,
            top: `${(hover.y / FLOOR_PLAN.imageHeight) * 100}%`,
          }}
        />
      )}

      {Object.entries(placements).map(([id, p]) => {
        const st = stationByKey[id]
        const isSel = id === selectedId
        const label = st?.name ?? id
        return (
          <div
            key={id}
            data-station-pin={id}
            className={`absolute z-10 ${isSel ? 'scale-110' : ''}`}
            style={{
              left: `${(p.x / FLOOR_PLAN.imageWidth) * 100}%`,
              top: `${(p.y / FLOOR_PLAN.imageHeight) * 100}%`,
            }}
          >
            <button
              type="button"
              title={`${label} — drag to move`}
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
                    ? 'bg-sky-500 border-sky-800 ring-2 ring-sky-300'
                    : 'bg-white border-sky-500'
                  }`}
              />
            </button>
            <span
              className="absolute left-0 top-0 -translate-x-1/2 translate-y-2
                         px-1 py-px rounded text-[8px] font-bold leading-none
                         bg-sky-600 text-white whitespace-nowrap pointer-events-none"
            >
              {label}
            </span>
            <button
              type="button"
              aria-label={`Remove ${label}`}
              title="Remove this station pin"
              className="absolute left-0 top-0 translate-x-2 -translate-y-3
                         w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center
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

/** Non-edit station pins (when showMarkers is on). */
export function StationMarkers({ placements, stations, showMarkers }) {
  if (!showMarkers) return null
  const stationByKey = Object.fromEntries(stations.map(s => [s.station, s]))
  return (
    <g className="station-markers pointer-events-none">
      {Object.entries(placements).map(([id, p]) => {
        if (p.visible === false) return null
        const st = stationByKey[id]
        return (
          <g key={id} transform={`translate(${p.x}, ${p.y})`} opacity={0.85}>
            <circle r={5} fill="#0ea5e9" stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <text
              y={-8}
              textAnchor="middle"
              style={{ fontSize: 8, fontWeight: 600, fill: '#0369a1' }}
            >
              {st?.name ?? id}
            </text>
          </g>
        )
      })}
    </g>
  )
}
