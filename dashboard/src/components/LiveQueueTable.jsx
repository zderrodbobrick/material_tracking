import { useState, useMemo } from 'react'
import { Search, Filter, Radio, X } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { OperatorCell } from './OperatorCell'
import { DwellTimer } from './DwellTimer'
import { parseEpc } from '../utils/parseEpc'

function formatTime(isoStr) {
 if (!isoStr) return '—'
 try {
  return new Date(isoStr).toLocaleTimeString('en-US', {
   hour: 'numeric',
   minute: '2-digit',
   second: '2-digit',
   hour12: true,
  })
 } catch {
  return isoStr
 }
}

export function LiveQueueTable({
 sessions,
 onEndSession,
 stationName = 'All Stations',
 title,
 compact = false,
 stacked = false,
 onUnpin,
}) {
 const [search, setSearch] = useState('')
 const [statusFilter, setStatusFilter] = useState('ALL')

 const displayTitle = title ?? `Live ${stationName} Queue`
 const columns = compact
  ? ['IBUS #', 'Operator', 'Status', 'Entered', 'Dwell', '']
  : ['IBUS #', 'Station', 'Operator', 'Status', 'Entered', 'Current Dwell', '']

 const filtered = useMemo(() => {
  return sessions.filter(s => {
   const p = parseEpc(s.epc)
   const hay = [
    s.epc,
    s.ibus_number,
    p.ibusNumber,
    s.part_name,
    s.operator_name,
   ].filter(Boolean).join(' ').toLowerCase()
   if (search && !hay.includes(search.toLowerCase())) return false
   if (statusFilter !== 'ALL' && s.status !== statusFilter) return false
   return true
  })
 }, [sessions, search, statusFilter])

 const inputCls = 'bb-input pl-8 pr-3 py-1.5 text-sm rounded-md w-44'

 const headerPad = stacked ? 'px-3 py-2' : compact ? 'px-3 py-3' : 'px-5 py-4'
 const cellPad = stacked ? 'px-2 py-1.5' : compact ? 'px-2.5 py-2' : 'px-4 py-3'
 const emptyPad = stacked ? 'px-3 py-6' : compact ? 'px-3 py-10' : 'px-5 py-14'

 return (
  <div className={`bb-panel animate-fade-in h-full flex flex-col ${compact ? 'w-full' : ''}`}>
   <div className={`${headerPad} border-b border-[#27272f]
           flex flex-col gap-2 shrink-0`}>
    <div className="flex items-start justify-between gap-2">
     <div className="min-w-0">
      <h2 className={`flex items-center gap-2 font-semibold text-[#eef2f7]
              ${compact ? 'text-sm' : 'text-base'}`}>
       <span className="relative flex w-2.5 h-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#4dc4f4] opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#4dc4f4]" />
       </span>
       <span className="truncate">{displayTitle}</span>
      </h2>
      <p className="text-xs text-[#8b939e] mt-0.5">
       {sessions.length} active session{sessions.length !== 1 ? 's' : ''}
      </p>
     </div>
     {onUnpin && (
      <button
       type="button"
       onClick={onUnpin}
       className="p-1.5 rounded-md text-[#8b939e] hover:text-[#eef2f7] hover:bg-[#4dc4f4]/10 transition-colors shrink-0"
       aria-label={`Unpin ${stationName} queue`}
       title="Unpin queue"
      >
       <X className="w-4 h-4" />
      </button>
     )}
    </div>
    <div className={`flex items-center gap-2 ${stacked ? 'flex-row flex-wrap' : compact ? 'flex-col items-stretch' : 'flex-wrap'}`}>
     <div className={`relative ${stacked ? 'flex-1 min-w-[120px]' : 'flex-1'}`}>
      <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#8b939e] pointer-events-none" />
      <input
       type="text"
       placeholder="Search IBUS..."
       value={search}
       onChange={e => setSearch(e.target.value)}
       className={(compact || stacked) ? inputCls.replace('w-44', 'w-full') : inputCls}
      />
     </div>
     <div className={`flex items-center gap-1.5 shrink-0 ${stacked ? '' : 'w-full'}`}>
      <Filter className="w-3.5 h-3.5 text-[#8b939e]" />
      <select
       value={statusFilter}
       onChange={e => setStatusFilter(e.target.value)}
       className="bb-select text-sm rounded-md px-2 py-1.5 w-full"
      >
       <option value="ALL">All</option>
       <option value="open">In Process</option>
       <option value="exit_only">Exit Only</option>
      </select>
     </div>
    </div>
   </div>

   {filtered.length === 0 ? (
    <div className={`${emptyPad} text-center flex-1 flex flex-col justify-center`}>
     <div className={`${stacked ? 'w-9 h-9' : 'w-12 h-12'} rounded-full flex items-center justify-center mx-auto mb-2
             bg-[#27272f]`}>
      <Radio className={`${stacked ? 'w-5 h-5' : 'w-6 h-6'} text-[#8b939e]`} />
     </div>
     <p className={`${stacked ? 'text-xs' : 'text-sm'} text-[#8b939e]`}>
      {sessions.length === 0 ? 'No active sessions — waiting for RFID reads' : 'No sessions match the current filter'}
     </p>
    </div>
   ) : (
    <div className="overflow-hidden flex-1 min-h-0">
     <table className={`w-full ${stacked ? 'text-[11px]' : compact ? 'text-xs' : 'text-sm'}`}>
      <thead className="sticky top-0 z-10">
       <tr className="text-left bg-[#08080a]
 border-b border-[#27272f]">
        {columns.map((h, i) => (
         <th key={i} className={`${cellPad} font-semibold whitespace-nowrap
                     text-[#8b939e]`}>
          {h}
         </th>
        ))}
       </tr>
      </thead>
      <tbody className="divide-y divide-[#27272f]/50">
       {filtered.map((s, i) => (
        <tr
         key={s.id}
         style={{ animationDelay: `${Math.min(i * 35, 400)}ms` }}
         className={`animate-row-in transition-colors
          ${s.status === 'exit_only'
           ? 'bg-[#fbbf24]/5 hover:bg-[#fbbf24]/10'
           : 'hover:bg-[#4dc4f4]/5'}`}
        >
         {(() => {
          const p = parseEpc(s.epc)
          const ibus = p.ibusNumber ?? s.ibus_number ?? s.epc ?? '—'
          return (
           <td className={`${cellPad} font-mono font-semibold whitespace-nowrap text-[#eef2f7]`}>
            {ibus}
           </td>
          )
         })()}
         {!compact && (
          <td className={`${cellPad} whitespace-nowrap text-xs text-[#8b939e]`}>
           {s.station_name ?? '—'}
          </td>
         )}
         <td className={`${cellPad} whitespace-nowrap text-xs`}>
          <OperatorCell session={s} liveFeed />
         </td>
         <td className={`${cellPad} whitespace-nowrap`}>
          <StatusBadge status={s.status} />
         </td>
         <td className={`${cellPad} whitespace-nowrap font-mono text-xs
                 text-[#8b939e]`}>
          {formatTime(s.entry_time)}
         </td>
         <td className={`${cellPad} whitespace-nowrap`}>
          <DwellTimer
           entranceTime={s.entry_time}
           entranceEpochMs={s.entry_epoch_ms}
           exitTime={null}
           dwellSeconds={null}
          />
         </td>
         <td className={`${cellPad} whitespace-nowrap`}>
          {onEndSession && (
           <button
            onClick={() => {
             const p = parseEpc(s.epc)
             const label = p.ibusNumber ?? s.ibus_number ?? s.epc
             if (window.confirm(`End session for ${label}?`)) {
              onEndSession(s.id)
             }
            }}
            className="text-xs font-medium px-2 py-0.5 rounded-md border transition-all
 text-[#f87171] border-[#f87171]/30 hover:bg-[#f87171]/10
                  active:scale-95"
           >
            End
           </button>
          )}
         </td>
        </tr>
       ))}
      </tbody>
     </table>
    </div>
   )}
  </div>
 )
}
