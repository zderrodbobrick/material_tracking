import { Factory } from 'lucide-react'
import { DwellTimer } from './DwellTimer'

const LIGHT_STYLES = {
 green: {
  dot: 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.7)]',
  ping: 'bg-green-400',
  title: 'In use — part and operator',
 },
 amber: {
  dot: 'bg-[#fbbf24]/100 shadow-[0_0_6px_rgba(245,158,11,0.7)]',
  ping: 'bg-amber-400',
  title: 'Part at station — no operator',
 },
 out: {
  dot: 'bg-[#8b939e] shadow-[0_0_4px_rgba(100,116,139,0.5)]',
  ping: 'bg-[#8b939e]',
  title: 'Out of use — no part',
 },
 idle: {
  dot: 'bg-[#27272f] ring-1 ring-[#27272f]',
  ping: null,
  title: 'Idle',
 },
}

function StatusLight({ light }) {
 const style = LIGHT_STYLES[light] ?? LIGHT_STYLES.idle

 return (
  <span
   className={`relative flex shrink-0 w-3 h-3 rounded-full ${style.dot}`}
   title={style.title}
  >
   {style.ping && (
    <span className={`absolute inset-0 rounded-full animate-ping opacity-40 ${style.ping}`} />
   )}
  </span>
 )
}

function DwellCell({ entranceTime, entranceEpochMs }) {
 if (!entranceTime && entranceEpochMs == null) {
  return <span className="text-[#8b939e]">—</span>
 }
 return (
  <DwellTimer
   entranceTime={entranceTime}
   entranceEpochMs={entranceEpochMs}
   exitTime={null}
   dwellSeconds={null}
  />
 )
}

const COLS = 'grid-cols-[1.5rem_minmax(0,1.15fr)_minmax(0,1fr)_minmax(4.5rem,0.7fr)_minmax(0,1fr)_minmax(4.5rem,0.7fr)]'

export function MachineStatusTable({ statuses }) {
 const inUseCount = statuses.filter(s => s.inUse).length
 const outOfUseCount = statuses.filter(s => !s.inUse && !s.hasPart).length

 return (
  <div className="animate-fade-in rounded-xl shadow-sm overflow-hidden h-full flex flex-col
 bg-[#18181d] border border-[#27272f]
          bg-[#18181d] border-[#27272f]/60 w-full">
   <div className="px-4 py-3.5 border-b border-[#27272f] shrink-0">
    <div className="min-w-0">
     <h2 className="flex items-center gap-2 text-base font-semibold text-[#eef2f7]">
      <Factory className="w-5 h-5 text-emerald-500 shrink-0" />
      <span className="truncate">Machine Status</span>
     </h2>
     <p className="text-sm text-[#8b939e] mt-0.5">
      {statuses.length} stations · {inUseCount} in use · {outOfUseCount} out of use
     </p>
    </div>
   </div>

   <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div
     className={`grid ${COLS} gap-x-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide
           text-[#8b939e] bg-[#08080a]
           border-b border-[#27272f] shrink-0`}
    >
     <span />
     <span>Station</span>
     <span>Part</span>
     <span>Part time</span>
     <span>Operator</span>
     <span>Op time</span>
    </div>

    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
     {statuses.map(row => (
      <div
       key={row.stationKey}
       className={`grid ${COLS} gap-x-2 px-4 items-center flex-1 min-h-[2.75rem]
             border-b border-[#27272f]/60 text-sm
             transition-colors hover:bg-[#4dc4f4]/5
             ${row.inUse ? '' : row.hasPart ? '' : 'opacity-80'}`}
      >
       <StatusLight light={row.light} />
       <span className="font-semibold text-[#eef2f7] truncate" title={row.stationName}>
        {row.stationName}
       </span>
       <span className="text-[#eef2f7] truncate" title={row.partLabel ?? undefined}>
        {row.partLabel ?? '—'}
       </span>
       <span className="whitespace-nowrap">
        <DwellCell
         entranceTime={row.partEntryTime}
         entranceEpochMs={row.partEntryEpochMs}
        />
       </span>
       <span className="text-[#eef2f7] truncate" title={row.operatorName ?? undefined}>
        {row.operatorName ?? '—'}
       </span>
       <span className="whitespace-nowrap">
        <DwellCell entranceTime={row.operatorEnteredAt} />
       </span>
      </div>
     ))}
    </div>
   </div>
  </div>
 )
}
