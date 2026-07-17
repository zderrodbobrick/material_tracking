import { useState, useMemo } from 'react'
import { Search, CheckCircle } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { OperatorCell } from './OperatorCell'
import { formatDwell } from './DwellTimer'
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

export function CompletedTable({ sessions }) {
 const [search, setSearch] = useState('')

 const filtered = useMemo(() => {
  if (!search) return sessions
  const q = search.toLowerCase()
  return sessions.filter(s =>
   `${s.epc ?? ''} ${s.ibus_number ?? ''} ${s.part_name ?? ''} ${s.operator_name ?? ''}`.toLowerCase().includes(q)
  )
 }, [sessions, search])

 return (
  <div className="animate-fade-in rounded-xl shadow-sm flex flex-col overflow-hidden
 bg-[#18181d] border border-[#27272f]
          bg-[#18181d] border-[#27272f]/60">
   <div className="px-5 py-4 border-b border-[#27272f]
 flex flex-wrap items-center justify-between gap-3">
    <div>
     <h2 className="flex items-center gap-2 text-base font-semibold text-[#eef2f7]">
      <CheckCircle className="w-4 h-4 text-[#34d399]" />
      Recently Completed
     </h2>
     <p className="text-xs text-[#8b939e] mt-0.5">Last 25 sessions</p>
    </div>
    <div className="relative">
     <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#8b939e] pointer-events-none" />
     <input
      type="text"
      placeholder="Search part / EPC..."
      value={search}
      onChange={e => setSearch(e.target.value)}
      className="pl-8 pr-3 py-1.5 text-sm rounded-md w-40 transition-colors
 border border-[#27272f] bg-[#18181d] text-[#eef2f7] placeholder-[#8b939e]
            focus:outline-none focus:ring-2 focus:ring-[#4dc4f4] focus:border-transparent
            bg-[#08080a] text-[#eef2f7] "
     />
    </div>
   </div>

   {filtered.length === 0 ? (
    <div className="px-5 py-12 text-center">
     <p className="text-sm text-[#8b939e]">
      {sessions.length === 0 ? 'No completed sessions yet' : 'No sessions match filter'}
     </p>
    </div>
   ) : (
    <div className="overflow-x-auto">
     <table className="w-full text-sm">
      <thead>
       <tr className="text-left bg-[#08080a]
 border-b border-[#27272f]">
        {['Qty', 'Part #', 'Type', 'WO #', 'Full EPC', 'Station', 'Operator', 'Status', 'Entered', 'Exit', 'Dwell'].map((h, i) => (
         <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap
 text-[#8b939e]">
          {h}
         </th>
        ))}
       </tr>
      </thead>
      <tbody className="divide-y divide-[#27272f]/50">
       {filtered.map((s, i) => (
        <tr
         key={s.id}
         style={{ animationDelay: `${Math.min(i * 30, 350)}ms` }}
         className="animate-row-in transition-colors hover:bg-[#4dc4f4]/5"
        >
         {(() => {
          const p = parseEpc(s.epc)
          const type = s.part_type ?? p.typeLabel
          const partNo = s.part_name ?? s.part_number ?? p.partNumber
          const wo = s.work_order ?? p.workOrder
          return p.isKnown ? (
           <>
            <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
             {p.qty}
            </td>
            <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
             {partNo}
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap">
             <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold
 bg-blue-100 text-blue-800 dark:bg-blue-500/20">
              {type}
             </span>
            </td>
            <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
             {wo}
            </td>
            <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-[#8b939e]">
             {p.formatted}
            </td>
           </>
          ) : (
           <td colSpan={5} className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
            {s.epc ?? s.ibus_number}
           </td>
          )
         })()}
         <td className="px-4 py-2.5 whitespace-nowrap text-xs text-[#8b939e]">
          {s.station_name ?? '—'}
         </td>
         <td className="px-4 py-2.5 whitespace-nowrap text-xs">
          <OperatorCell session={s} />
         </td>
         <td className="px-4 py-2.5 whitespace-nowrap">
          <StatusBadge status={s.status} />
         </td>
         <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs
 text-[#8b939e]">
          {formatTime(s.entry_time)}
         </td>
         <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs
 text-[#8b939e]">
          {formatTime(s.exit_time)}
         </td>
         <td className="px-4 py-2.5 whitespace-nowrap">
          <span className="font-mono text-xs font-semibold text-[#eef2f7] dark:text-[#eef2f7]">
           {s.dwell_seconds != null ? formatDwell(s.dwell_seconds) : '—'}
          </span>
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
