import { Radio } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
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

export function RecentReadsPanel({ reads }) {
 return (
  <div className="animate-fade-in rounded-xl shadow-sm flex flex-col overflow-hidden
 bg-[#18181d] border border-[#27272f]
          bg-[#18181d] border-[#27272f]/60">
   <div className="px-5 py-4 border-b border-[#27272f]">
    <h2 className="flex items-center gap-2 text-base font-semibold text-[#eef2f7]">
     <Radio className="w-4 h-4 text-[#4dc4f4]" />
     Recent RFID Activity
    </h2>
    <p className="text-xs text-[#8b939e] mt-0.5">Most recently seen tags — live feed</p>
   </div>

   {reads.length === 0 ? (
    <div className="px-5 py-12 text-center">
     <p className="text-sm text-[#8b939e]">No reads yet — waiting for reader events</p>
    </div>
   ) : (
    <div className="overflow-x-auto">
     <table className="w-full text-sm">
      <thead>
       <tr className="text-left bg-[#08080a]
 border-b border-[#27272f]">
        {['Read Time', 'Qty', 'Part #', 'Type', 'WO #', 'Full EPC', 'Antenna', 'Role', 'RSSI'].map((h, i) => (
         <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap
 text-[#8b939e]">
          {h}
         </th>
        ))}
       </tr>
      </thead>
      <tbody className="divide-y divide-[#27272f]/50">
       {reads.map((r, i) => (
        <tr
         key={i}
         style={{ animationDelay: `${Math.min(i * 30, 350)}ms` }}
         className="animate-row-in transition-colors hover:bg-[#4dc4f4]/5"
        >
         <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs
 text-[#8b939e]">
          {formatTime(r.read_time)}
         </td>
         {(() => {
          const p = parseEpc(r.epc)
          return p.isKnown ? (
           <>
            <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
             {p.qty}
            </td>
            <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
             {p.partNumber}
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap">
             <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold
 bg-blue-100 text-blue-800 dark:bg-blue-500/20">
              {p.typeLabel}
             </span>
            </td>
            <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
             {p.workOrder}
            </td>
            <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-[#8b939e]">
             {p.formatted}
            </td>
           </>
          ) : (
           <td colSpan={5} className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap text-[#eef2f7]">
            {r.epc}
           </td>
          )
         })()}
         <td className="px-4 py-2.5 whitespace-nowrap text-xs text-[#8b939e]">
          {r.antenna_name ?? (r.antenna_port != null ? `Port ${r.antenna_port}` : '—')}
         </td>
         <td className="px-4 py-2.5 whitespace-nowrap">
          {r.role ? <StatusBadge status={r.role} /> : <span className="text-[#8b939e]">—</span>}
         </td>
         <td className="px-4 py-2.5 whitespace-nowrap">
          <span className="font-mono text-xs text-[#8b939e]">
           {r.rssi != null ? `${r.rssi} dBm` : '—'}
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
