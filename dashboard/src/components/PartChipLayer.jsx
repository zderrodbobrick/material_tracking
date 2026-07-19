import { useEffect, useMemo, useRef, useState } from 'react'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { polygonCentroid } from '../utils/machinePolygons'
import { partChipLabel } from '../utils/antennaPlacements'
import { ibusOrderKey } from '../utils/ibusOrder'
import { ibusAccent } from '../utils/ibusColors'
import { parseEpc } from '../utils/parseEpc'

/**
 * Resolve where a live session should appear on the floor plan:
 * 1) placed last-antenna pin
 * 2) machine polygon centroid for the session station
 */
function resolvePartOrigin(session, placements, machinesByStation) {
 const antId = session.last_antenna_id != null ? String(session.last_antenna_id) : null
 const antPort = session.last_antenna_port != null ? String(session.last_antenna_port) : null
 const pin = (antId && placements[antId])
  || (antPort && placements[antPort])
  || null
 if (pin) {
  return {
   x: pin.x,
   y: pin.y,
   source: 'antenna',
   antennaId: antId || antPort,
  }
 }

 const station = session.station_name
 const aliases = station === 'Tennoner' || station === 'Tenoner'
  ? ['Tennoner', 'Tenoner']
  : [station]
 for (const key of aliases) {
  const machine = machinesByStation.get(key)
  if (machine?.polygon?.length >= 3) {
   const c = polygonCentroid(machine.polygon)
   return { x: c.x, y: c.y, source: 'machine', antennaId: null }
  }
 }

 return null
}

function stackTitle(group) {
 const first = group.items[0]?.session
 const where = first?.last_antenna_name || first?.last_antenna_role || first?.station_name || 'parts'
 const order = group.orderKey ? ` · ${group.orderKey}` : ''
 return `${group.items.length} part${group.items.length !== 1 ? 's' : ''} · ${where}${order}`
}

/** Fan sibling order-stacks at the same pin so two work orders stay visible. */
function offsetForSibling(index, total) {
 if (total <= 1) return { dx: 0, dy: 0 }
 const spread = 14
 const mid = (total - 1) / 2
 return { dx: (index - mid) * spread, dy: (index - mid) * 4 }
}

/**
 * Colored dots for open parts at last antenna / machine center.
 * Stacks by location + IBUS order so different work orders keep distinct colors.
 */
function delayColor(level, fallbackHex) {
 if (level === 'critical') return { hex: '#f87171', ping: 'bg-[#f87171]', badge: 'bg-[#f87171]' }
 if (level === 'warn') return { hex: '#fbbf24', ping: 'bg-[#fbbf24]', badge: 'bg-[#fbbf24]' }
 return { hex: fallbackHex, ping: 'bg-white', badge: 'bg-[#27272f]' }
}

/**
 * Active parts on the floor plan.
 * @param {(session) => 'ok'|'warn'|'critical'|null} [getDelayLevel]
 */
export function PartChipLayer({
 sessions = [],
 placements = {},
 machines = [],
 onPartClick,
 getDelayLevel,
}) {
 const [openKey, setOpenKey] = useState(null)
 const popoverRef = useRef(null)

 const machinesByStation = useMemo(
  () => new Map(machines.map(m => [m.station, m])),
  [machines],
 )

 const knownOrderKeys = useMemo(() => {
  const seen = []
  for (const s of sessions) {
   const k = ibusOrderKey(s)
   if (k && !seen.includes(k)) seen.push(k)
  }
  return seen
 }, [sessions])

 const groups = useMemo(() => {
  const map = new Map()
  for (const session of sessions) {
   const origin = resolvePartOrigin(session, placements, machinesByStation)
   if (!origin) continue
   const orderKey = ibusOrderKey(session) || 'unknown'
   const locKey = origin.antennaId
    ? `ant:${origin.antennaId}`
    : `st:${session.station_name}`
   const key = `${locKey}::${orderKey}`
   if (!map.has(key)) {
    map.set(key, {
     key,
     locKey,
     orderKey,
     origin,
     accent: ibusAccent(orderKey, knownOrderKeys),
     items: [],
    })
   }
   map.get(key).items.push({
    session,
    label: partChipLabel(session, parseEpc),
   })
  }

  // Sibling index per location for visual offset
  const byLoc = new Map()
  for (const g of map.values()) {
   if (!byLoc.has(g.locKey)) byLoc.set(g.locKey, [])
   byLoc.get(g.locKey).push(g)
  }
  for (const siblings of byLoc.values()) {
   siblings.sort((a, b) => a.orderKey.localeCompare(b.orderKey))
   siblings.forEach((g, i) => {
    g.siblingIndex = i
    g.siblingTotal = siblings.length
   })
  }

  return [...map.values()]
 }, [sessions, placements, machinesByStation, knownOrderKeys])

 useEffect(() => {
  if (!openKey) return
  const onDoc = (e) => {
   if (popoverRef.current?.contains(e.target)) return
   if (e.target?.closest?.('[data-part-stack]')) return
   setOpenKey(null)
  }
  const onKey = (e) => { if (e.key === 'Escape') setOpenKey(null) }
  document.addEventListener('mousedown', onDoc)
  window.addEventListener('keydown', onKey)
  return () => {
   document.removeEventListener('mousedown', onDoc)
   window.removeEventListener('keydown', onKey)
  }
 }, [openKey])

 useEffect(() => {
  if (openKey && !groups.some(g => g.key === openKey)) setOpenKey(null)
 }, [groups, openKey])

 if (groups.length === 0) return null

 return (
  <>
   {groups.map(group => {
    const { x, y } = group.origin
    const { dx, dy } = offsetForSibling(group.siblingIndex ?? 0, group.siblingTotal ?? 1)
    const count = group.items.length
    const open = openKey === group.key
    const left = `${(x / FLOOR_PLAN.imageWidth) * 100}%`
    const top = `${(y / FLOOR_PLAN.imageHeight) * 100}%`
    const worstDelay = group.items.reduce((worst, item) => {
     const level = getDelayLevel?.(item.session) ?? 'ok'
     if (level === 'critical') return 'critical'
     if (level === 'warn' && worst !== 'critical') return 'warn'
     return worst
    }, 'ok')
    const delay = delayColor(worstDelay, group.accent.hex)
    const accent = group.accent

    return (
     <div
      key={group.key}
      data-part-stack={group.key}
      className="absolute z-[18] pointer-events-auto"
      style={{
       left,
       top,
       transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`,
      }}
     >
      <button
       type="button"
       title={
        worstDelay === 'critical'
         ? `${stackTitle(group)} · over threshold`
         : worstDelay === 'warn'
          ? `${stackTitle(group)} · over target`
          : stackTitle(group)
       }
       aria-expanded={open}
       aria-label={stackTitle(group)}
       onClick={e => {
        e.stopPropagation()
        setOpenKey(prev => (prev === group.key ? null : group.key))
       }}
       className="relative flex items-center justify-center w-2.5 h-2.5 rounded-full
 ring-2 ring-white/80 focus:outline-none focus-visible:ring-2"
       style={{
        backgroundColor: delay.hex,
        boxShadow: worstDelay !== 'ok' ? `0 0 8px ${delay.hex}aa` : `0 0 6px ${delay.hex}66`,
       }}
      >
       {worstDelay === 'ok' && (
        <span
         className={`absolute inset-0 rounded-full animate-ping opacity-20 ${delay.ping} [animation-duration:2s]`}
        />
       )}
       <span className="relative w-1.5 h-1.5 rounded-full bg-[#18181d]" />
       {count > 1 && (
        <span
         className={`absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5
               flex items-center justify-center rounded-full
               text-[8px] font-bold leading-none text-white border border-white/80
               ${worstDelay !== 'ok' ? delay.badge : accent.badge}`}
        >
         {count}
        </span>
       )}
      </button>

      {open && (
       <div
        ref={popoverRef}
        role="dialog"
        aria-label="Parts at this location"
        className={`absolute left-1/2 top-full mt-2 -translate-x-1/2 z-30
              w-64 max-h-56 overflow-auto rounded-lg border shadow-xl
              bg-[#08080a] ${accent.popoverBorder}`}
        onClick={e => e.stopPropagation()}
       >
        <div className={`sticky top-0 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider
                border-b ${accent.popoverHead}`}>
         {count} part{count !== 1 ? 's' : ''} · {group.orderKey}
        </div>
        <ul className="py-1">
         {group.items.map(item => {
          const s = item.session
          const role = s.last_antenna_role || s.last_antenna_name
          return (
           <li key={s.session_id ?? s.id ?? item.label}>
            <button
             type="button"
             className={`w-full text-left px-2.5 py-1.5 flex flex-col gap-0.5 ${accent.rowHover}`}
             onClick={e => {
              e.stopPropagation()
              setOpenKey(null)
              onPartClick?.(s, e)
             }}
            >
             <span className="text-[11px] font-semibold text-[#eef2f7] font-mono break-all">
              {item.label}
             </span>
             <span className="text-[10px] text-[#8b939e] truncate">
              {[s.station_name, role].filter(Boolean).join(' · ')}
             </span>
            </button>
           </li>
          )
         })}
        </ul>
       </div>
      )}
     </div>
    )
   })}
  </>
 )
}
