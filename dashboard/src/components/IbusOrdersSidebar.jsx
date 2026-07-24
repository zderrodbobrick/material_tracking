import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ibusOrderKey, partTagLabel } from '../utils/ibusOrder'
import { ibusAccent } from '../utils/ibusColors'
import { DwellTimer, formatDwell } from './DwellTimer'
import { PRODUCTION_LINE_ORDER } from '../utils/machineRegions'

const COMPLETE_HOLD_MS = 900
const DEPART_MS = 1100

function ibusLabel(j) {
 return j.ibus_order ?? j.ibus_number ?? ibusOrderKey(j) ?? j.key ?? '—'
}

function shortStation(name) {
 if (!name) return '—'
 if (name === 'Tenoner' || name === 'Tennoner') return 'Tennoner'
 const hit = PRODUCTION_LINE_ORDER.find(s => s === name)
 if (hit) {
  return name.replace(/^Insert Station$/, 'Insert')
   .replace(/^Evolve Edge Finisher$/, 'Evolve Edge')
   .replace(/^Evolve Drilling$/, 'Evolve Drill')
   .replace(/^LB Installation$/, 'LB Install')
   .replace(/^Outswing Latch Drilling$/, 'LB Install')
   .replace(/^1\/2 Edgefinisher$/, 'Edgefinisher')
   .replace(/^Holzma\.Falloff$/, 'Falloff')
 }
 return name
}

function progressPct(j) {
 if (typeof j.progress === 'number') {
  return Math.round(Math.min(1, Math.max(0, j.progress)) * 100)
 }
 const spine = ['Tenoner', 'LBD', 'Gannomat', 'Insert Station']
 const raw = j.current_station === 'Tennoner' ? 'Tenoner' : j.current_station
 const idx = spine.indexOf(raw)
 if (idx < 0) return 0
 return Math.round((idx / Math.max(spine.length - 1, 1)) * 100)
}

function orderPartCount(j) {
 return j?.expected_parts ?? j?.estimated_parts ?? j?.part_count ?? j?.parts?.length ?? 0
}

function looksComplete(j) {
 const parts = j?.parts ?? []
 if (!parts.length) return false
 const expected = j?.expected_parts ?? j?.estimated_parts
 // Wait until the full BOM is on the journey before celebrating.
 if (expected && parts.length < expected) return false
 const allAtInsert = parts.every(p => {
  const st = p?.current_station || ''
  return st === 'Insert Station' || st === 'Insert'
 })
 return allAtInsert && progressPct(j) >= 100
}

function partCurrentStation(p) {
 if (p?.current_station) return p.current_station
 const machines = p?.machines ?? []
 const open = [...machines].reverse().find(m => m.status === 'open' || m.status === 'Open')
 if (open?.station_name) return open.station_name
 return machines.at(-1)?.station_name || '—'
}

function partOpenMachine(p) {
 const machines = p?.machines ?? []
 return [...machines].reverse().find(m => m.status === 'open' || m.status === 'Open') || null
}

/**
 * Open IBUS orders as a compact production list.
 * Supports controlled selection via selectedKey / onSelectedKeyChange.
 */
export function IbusOrdersSidebar({
 journeys = [],
 selectedKey: selectedKeyProp,
 onSelectedKeyChange,
}) {
 const [internalKey, setInternalKey] = useState(null)
 const selectedKey = selectedKeyProp !== undefined ? selectedKeyProp : internalKey
 const setSelectedKey = (key) => {
  if (selectedKeyProp === undefined) setInternalKey(key)
  onSelectedKeyChange?.(key)
 }
 /** @type {Record<string, { journey: object, phase: 'celebrate' | 'depart' }>} */
 const [staging, setStaging] = useState({})
 const prevRef = useRef([])
 const timersRef = useRef(new Map())
 /** Keys already animated out — stay hidden until they leave the open API for real. */
 const hiddenRef = useRef(new Set())

 useEffect(() => {
  return () => {
   for (const t of timersRef.current.values()) clearTimeout(t)
   timersRef.current.clear()
  }
 }, [])

 useEffect(() => {
  const prev = prevRef.current
  const nowKeys = new Set(journeys.map(j => j.key ?? ibusLabel(j)))

  // Drop hide-mask once the API no longer lists the order as open.
  for (const key of [...hiddenRef.current]) {
   if (!nowKeys.has(key)) hiddenRef.current.delete(key)
  }

  setStaging(prevStaging => {
   let next = { ...prevStaging }

   for (const j of journeys) {
    const key = j.key ?? ibusLabel(j)
    if (hiddenRef.current.has(key)) {
     // Still complete → keep hidden. Regressed → show again.
     if (!looksComplete(j)) hiddenRef.current.delete(key)
     else continue
    }
    if (looksComplete(j) && !next[key]) {
     next[key] = { journey: j, phase: 'celebrate' }
     const existing = timersRef.current.get(key)
     if (existing) clearTimeout(existing)
     const t = setTimeout(() => {
      setStaging(s => {
       if (!s[key] || s[key].phase !== 'celebrate') return s
       return { ...s, [key]: { ...s[key], phase: 'depart' } }
      })
      const t2 = setTimeout(() => {
       hiddenRef.current.add(key)
       setStaging(s => {
        const copy = { ...s }
        delete copy[key]
        return copy
       })
       timersRef.current.delete(key)
      }, DEPART_MS)
      timersRef.current.set(key, t2)
     }, COMPLETE_HOLD_MS)
     timersRef.current.set(key, t)
    } else if (next[key] && next[key].phase === 'celebrate') {
     next[key] = { ...next[key], journey: j }
    }
   }

   for (const j of prev) {
    const key = j.key ?? ibusLabel(j)
    if (nowKeys.has(key)) continue
    if (!looksComplete(j) && !next[key]) continue
    if (next[key]?.phase === 'depart') continue
    next[key] = { journey: next[key]?.journey ?? j, phase: 'depart' }
    const existing = timersRef.current.get(key)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
     hiddenRef.current.add(key)
     setStaging(s => {
      const copy = { ...s }
      delete copy[key]
      return copy
     })
     timersRef.current.delete(key)
    }, DEPART_MS)
    timersRef.current.set(key, t)
   }

   return next
  })

  prevRef.current = journeys
 }, [journeys])

 const knownKeys = useMemo(
  () => journeys.map(j => j.key ?? ibusLabel(j)).filter(Boolean),
  [journeys],
 )

 const selected = useMemo(() => {
  if (selectedKey == null) return null
  return journeys.find(j => {
   const key = j.key ?? ibusLabel(j)
   if (key === selectedKey) return true
   const label = ibusLabel(j)
   return label === selectedKey || j.ibus_number === selectedKey || j.work_order === selectedKey
  }) ?? null
 }, [journeys, selectedKey])

 const displayRows = useMemo(() => {
  const items = []
  const seen = new Set()
  for (const j of journeys) {
   const key = j.key ?? ibusLabel(j)
   if (hiddenRef.current.has(key) && !staging[key]) continue
   seen.add(key)
   const st = staging[key]
   items.push({
    key,
    journey: st?.journey ?? j,
    phase: st?.phase ?? (looksComplete(j) ? 'celebrate' : 'normal'),
   })
  }
  for (const [key, st] of Object.entries(staging)) {
   if (seen.has(key)) continue
   if (st.phase !== 'depart' && st.phase !== 'celebrate') continue
   items.push({ key, journey: st.journey, phase: st.phase })
  }
  return items
 }, [journeys, staging])

 useEffect(() => {
  if (selectedKey && !journeys.some(j => (j.key ?? ibusLabel(j)) === selectedKey)) {
   setSelectedKey(null)
  }
 }, [journeys, selectedKey])

 return (
  <aside className="flex flex-col min-h-0 min-w-0 w-full h-full">
   <div className="bb-panel flex flex-col flex-1 min-h-0 h-full">
    <div className="bb-panel-header">
     <div className="min-w-0">
      <h2 className="bb-title">
       {selected ? (
        <button
         type="button"
         onClick={() => setSelectedKey(null)}
         className="inline-flex items-center gap-1 text-[#8b939e] hover:text-[#eef2f7]"
         title="Back to orders"
        >
         <ArrowLeft className="w-3.5 h-3.5" />
        </button>
       ) : null}
       {selected ? ibusLabel(selected) : 'Current Production'}
      </h2>
      <p className="bb-subtitle">
       {selected
        ? `${shortStation(selected.current_station)} · part locations`
        : 'Open IBUS orders'}
      </p>
     </div>
     <span className="tabular-nums text-xs font-medium text-[#8b939e]">
      {selected
       ? `${orderPartCount(selected)} parts`
       : journeys.length}
     </span>
    </div>

    {selected ? (
     <OrderPartsDetail order={selected} accent={ibusAccent(selected.key ?? ibusLabel(selected), knownKeys)} />
    ) : displayRows.length === 0 ? (
     <p className="bb-empty">No open IBUS orders</p>
    ) : (
     <div className="overflow-y-auto flex-1 min-h-0">
      <table className="bb-table">
       <thead className="bb-table-head sticky top-0 z-10">
        <tr>
         <th>IBUS</th>
         <th>Station</th>
         <th className="text-right">Progress</th>
         <th className="text-right">Elapsed</th>
        </tr>
       </thead>
       <tbody>
        {displayRows.map(({ key, journey: j, phase }) => {
         const label = ibusLabel(j)
         const pct = phase === 'normal' ? progressPct(j) : 100
         const done = phase === 'celebrate' || phase === 'depart'
         const anim =
          phase === 'depart'
           ? 'animate-ibus-depart pointer-events-none'
           : phase === 'celebrate'
            ? 'animate-ibus-complete'
            : ''
         return (
          <tr
           key={key}
           className={`bb-table-row cursor-pointer ${anim} ${done ? 'opacity-80' : ''}`}
           onClick={() => { if (!done) setSelectedKey(key) }}
           title={done ? `${label} · Complete` : `${label} · ${pct}%`}
          >
           <td>
            <p className="font-mono text-xs font-semibold text-[#eef2f7]">{label}</p>
            {orderPartCount(j) > 1 && (
             <p className="text-[10px] text-[#8b939e]">{orderPartCount(j)} parts</p>
            )}
           </td>
           <td className="text-xs text-[#8b939e]">
            {done ? <span className="text-[#34d399]">Complete</span> : shortStation(j.current_station)}
           </td>
           <td className="text-right">
            <div className="inline-flex flex-col items-end gap-0.5 min-w-[3.5rem]">
             <span className={`text-xs font-semibold tabular-nums ${done ? 'text-[#34d399]' : 'text-[#4dc4f4]'}`}>
              {pct}%
             </span>
             <span className="h-1 w-12 rounded-sm bg-[#2a2a32] overflow-hidden">
              <span
               className={`block h-full ${done ? 'bg-[#34d399]' : 'bg-[#4dc4f4]'}`}
               style={{ width: `${pct}%` }}
              />
             </span>
            </div>
           </td>
           <td className="text-right font-mono text-[11px] text-[#8b939e] whitespace-nowrap">
            {j.total_production_display
             ?? formatDwell(j.total_production_seconds)
             ?? '—'}
           </td>
          </tr>
         )
        })}
       </tbody>
      </table>
     </div>
    )}
   </div>
  </aside>
 )
}

function OrderPartsDetail({ order, accent }) {
 const parts = order.parts ?? []

 return (
  <div className="overflow-y-auto flex-1 min-h-0">
   {order.estimated_total_display && (
    <div className="px-3 py-2 border-b border-[#2a2a32] bg-[#08080a]/50">
     <p className="text-[10px] uppercase tracking-wider text-[#8b939e]">Order estimate</p>
     <p className="text-sm font-mono tabular-nums text-[#4dc4f4] mt-0.5">
      {order.estimated_total_display}
      <span className="text-[#8b939e] text-xs font-normal ml-1.5">
       ({orderPartCount(order)} parts)
      </span>
     </p>
    </div>
   )}
   {parts.length === 0 ? (
    <p className="bb-empty">No parts tracked for this order yet</p>
   ) : (
    <table className="bb-table">
     <thead className="bb-table-head">
      <tr>
       <th>Part</th>
       <th>Drawing</th>
       <th>Station</th>
       <th className="text-right">Dwell</th>
      </tr>
     </thead>
     <tbody>
      {parts.map(p => {
       const tag = p.part_tag || partTagLabel(p) || p.epc || '—'
       const station = partCurrentStation(p)
       const openM = partOpenMachine(p)
       return (
        <tr key={p.epc || tag} className="bb-table-row">
         <td>
          <div className="flex items-start gap-2">
           <span
            className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: accent.hex }}
           />
           <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold text-[#eef2f7] break-all">{tag}</p>
            <p className="text-[10px] text-[#8b939e] truncate">
             {[p.part_number, p.part_name].filter(Boolean).join(' · ') || '—'}
            </p>
           </div>
          </div>
         </td>
         <td className="text-[10px] text-[#eef2f7] max-w-[9rem] truncate" title={p.drawing || ''}>
          {p.drawing || '—'}
         </td>
         <td className="text-xs text-[#8b939e]">{shortStation(station)}</td>
         <td className="text-right font-mono text-[11px] text-[#8b939e]">
          {openM ? (
           <DwellTimer
            entranceTime={openM.entry_time}
            exitTime={null}
            dwellSeconds={null}
           />
          ) : (
           p.total_production_display
            ?? formatDwell(p.total_production_seconds)
            ?? '—'
          )}
         </td>
        </tr>
       )
      })}
     </tbody>
    </table>
   )}
  </div>
 )
}
