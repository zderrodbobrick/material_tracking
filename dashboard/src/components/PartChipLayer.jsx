import { useEffect, useMemo, useRef, useState } from 'react'
import { FLOOR_PLAN } from '../utils/floorPlanCoords'
import { polygonCentroid } from '../utils/machinePolygons'
import { partChipLabel } from '../utils/antennaPlacements'
import { parseEpc } from '../utils/parseEpc'

/**
 * Resolve where a live session should appear on the floor plan:
 * 1) placed last-antenna pin
 * 2) machine polygon centroid for the session station
 */
function resolvePartOrigin(session, placements, machinesByStation) {
  const antId = session.last_antenna_id != null ? String(session.last_antenna_id) : null
  if (antId && placements[antId]) {
    return {
      x: placements[antId].x,
      y: placements[antId].y,
      source: 'antenna',
      antennaId: antId,
    }
  }

  const machine = machinesByStation.get(session.station_name)
  if (machine?.polygon?.length >= 3) {
    const c = polygonCentroid(machine.polygon)
    return { x: c.x, y: c.y, source: 'machine', antennaId: null }
  }

  return null
}

function stackTitle(group) {
  const first = group.items[0]?.session
  const where = first?.last_antenna_name || first?.last_antenna_role || first?.station_name || 'parts'
  return `${group.items.length} part${group.items.length !== 1 ? 's' : ''} · ${where}`
}

/**
 * Small amber dots (operator-sized) for open parts at last antenna / machine center.
 * Multiple parts at the same spot stack into one dot with a count; click to list them.
 */
export function PartChipLayer({
  sessions = [],
  placements = {},
  machines = [],
  onPartClick,
}) {
  const [openKey, setOpenKey] = useState(null)
  const popoverRef = useRef(null)

  const machinesByStation = useMemo(
    () => new Map(machines.map(m => [m.station, m])),
    [machines],
  )

  const groups = useMemo(() => {
    const map = new Map()
    for (const session of sessions) {
      const origin = resolvePartOrigin(session, placements, machinesByStation)
      if (!origin) continue
      const key = origin.antennaId
        ? `ant:${origin.antennaId}`
        : `st:${session.station_name}`
      if (!map.has(key)) map.set(key, { key, origin, items: [] })
      map.get(key).items.push({
        session,
        label: partChipLabel(session, parseEpc),
      })
    }
    return [...map.values()]
  }, [sessions, placements, machinesByStation])

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

  // Close popover if that stack disappears
  useEffect(() => {
    if (openKey && !groups.some(g => g.key === openKey)) setOpenKey(null)
  }, [groups, openKey])

  if (groups.length === 0) return null

  return (
    <>
      {groups.map(group => {
        const { x, y } = group.origin
        const count = group.items.length
        const open = openKey === group.key
        const left = `${(x / FLOOR_PLAN.imageWidth) * 100}%`
        const top = `${(y / FLOOR_PLAN.imageHeight) * 100}%`

        return (
          <div
            key={group.key}
            data-part-stack={group.key}
            className="absolute z-[18] pointer-events-auto"
            style={{
              left,
              top,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <button
              type="button"
              title={stackTitle(group)}
              aria-expanded={open}
              aria-label={stackTitle(group)}
              onClick={e => {
                e.stopPropagation()
                setOpenKey(prev => (prev === group.key ? null : group.key))
              }}
              className="relative flex items-center justify-center w-2.5 h-2.5 rounded-full
                         bg-amber-500 ring-2 ring-white/80 shadow-[0_0_10px_rgba(245,158,11,0.55)]
                         hover:bg-amber-400 focus:outline-none focus-visible:ring-amber-300"
            >
              <span className="absolute inset-0 rounded-full animate-ping opacity-25 bg-amber-400 [animation-duration:1.8s]" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-white" />
              {count > 1 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5
                             flex items-center justify-center rounded-full
                             text-[8px] font-bold leading-none
                             bg-amber-700 text-white border border-white/80"
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
                className="absolute left-1/2 top-full mt-2 -translate-x-1/2 z-30
                           w-64 max-h-56 overflow-auto rounded-lg border shadow-xl
                           bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-500/30"
                onClick={e => e.stopPropagation()}
              >
                <div className="sticky top-0 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider
                                text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10
                                border-b border-amber-100 dark:border-amber-500/20">
                  {count} part{count !== 1 ? 's' : ''} here
                </div>
                <ul className="py-1">
                  {group.items.map(item => {
                    const s = item.session
                    const role = s.last_antenna_role || s.last_antenna_name
                    return (
                      <li key={s.session_id ?? s.id ?? item.label}>
                        <button
                          type="button"
                          className="w-full text-left px-2.5 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-500/10
                                     flex flex-col gap-0.5"
                          onClick={e => {
                            e.stopPropagation()
                            setOpenKey(null)
                            onPartClick?.(s, e)
                          }}
                        >
                          <span className="text-[11px] font-semibold text-gray-900 dark:text-slate-100 font-mono break-all">
                            {item.label}
                          </span>
                          <span className="text-[10px] text-gray-500 dark:text-slate-400 truncate">
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
