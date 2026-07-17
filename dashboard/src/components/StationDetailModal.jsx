import { useEffect } from 'react'
import { X, Factory, Users, Package, Pin, PinOff } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { OperatorCell } from './OperatorCell'
import { DwellTimer } from './DwellTimer'
import { parseEpc } from '../utils/parseEpc'

function partLabel(session) {
 const p = parseEpc(session.epc ?? session.ibus_number)
 return p.ibusNumber ?? session.ibus_number ?? session.epc ?? '—'
}

function formatTime(isoStr) {
 if (!isoStr) return '—'
 try {
  return new Date(isoStr).toLocaleTimeString('en-US', {
   hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
 } catch {
  return isoStr
 }
}

export function StationDetailModal({ machine, sessions, operatorsInZone, onClose, isPinned, onTogglePin, pinLimitReached }) {
 useEffect(() => {
  const onKey = (e) => { if (e.key === 'Escape') onClose() }
  window.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  return () => {
   window.removeEventListener('keydown', onKey)
   document.body.style.overflow = ''
  }
 }, [onClose])

 return (
  <div
   className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
   onClick={onClose}
   role="dialog"
   aria-modal="true"
   aria-labelledby="station-modal-title"
  >
   <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />

   <div
    className="relative w-full sm:max-w-lg max-h-[85vh] overflow-hidden
 rounded-t-2xl sm:rounded-2xl shadow-2xl
          bg-[#08080a]
          border border-[#27272f]
          animate-fade-in-scale"
    onClick={e => e.stopPropagation()}
   >
    <div className="flex items-start justify-between gap-3 px-5 py-4
 border-b border-[#27272f]
            bg-[#08080a] bg-[#18181d]/80">
     <div className="flex items-center gap-3 min-w-0">
      <span className="flex items-center justify-center w-10 h-10 rounded-xl
 bg-violet-100 dark:bg-[#a78bfa]/100/15 shrink-0">
       <Factory className="w-5 h-5 text-[#4dc4f4]" />
      </span>
      <div className="min-w-0">
       <h2 id="station-modal-title" className="text-lg font-bold text-[#eef2f7] truncate">
        {machine.name}
       </h2>
       <p className="text-xs text-[#8b939e]">
        {sessions.length} part{sessions.length !== 1 ? 's' : ''} in process
        {operatorsInZone.length > 0 && ` · ${operatorsInZone.length} in zone`}
       </p>
      </div>
     </div>
     <div className="flex items-center gap-1 shrink-0">
      {onTogglePin && (
       <button
        type="button"
        onClick={onTogglePin}
        disabled={!isPinned && pinLimitReached}
        title={isPinned ? 'Unpin live queue' : pinLimitReached ? 'Maximum pinned queues reached' : 'Pin live queue beside map'}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
         ${isPinned
          ? 'text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
          : pinLimitReached
           ? 'text-[#8b939e] bg-[#27272f] cursor-not-allowed dark:text-[#8b939e] bg-[#18181d]'
           : 'text-[#8b939e] hover:text-[#eef2f7] hover:bg-[#4dc4f4]/10 dark:text-[#8b939e] dark:hover:text-[#8b939e]100 hover:bg-[#4dc4f4]/10'
         }`}
       >
        {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        {isPinned ? 'Unpin' : 'Pin queue'}
       </button>
      )}
      <button
       type="button"
       onClick={onClose}
       className="p-2 rounded-lg text-[#8b939e] hover:text-[#eef2f7] hover:bg-[#4dc4f4]/10
 dark:text-[#8b939e] dark:hover:text-[#8b939e]100 hover:bg-[#4dc4f4]/10
             transition-colors shrink-0"
       aria-label="Close"
      >
       <X className="w-5 h-5" />
      </button>
     </div>
    </div>

    <div className="overflow-y-auto max-h-[calc(85vh-4.5rem)]">
     <section className="px-5 py-4 border-b border-[#27272f]">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider
 text-[#8b939e] mb-3">
       <Users className="w-3.5 h-3.5" />
       Operators in zone
      </h3>
      {operatorsInZone.length === 0 ? (
       <p className="text-sm text-[#8b939e]">No operators currently in this zone</p>
      ) : (
       <ul className="space-y-2">
        {operatorsInZone.map(op => (
         <li
          key={op.tag_id}
          className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg
 bg-[#4dc4f4]/10 dark:bg-[#4dc4f4]/100/10 border border-sky-100 border-[#4dc4f4]/20"
         >
          <div>
           <p className="text-sm font-semibold text-[#eef2f7]">{op.operator_name}</p>
           <p className="text-[10px] text-[#8b939e]">{op.zone_name}</p>
          </div>
         </li>
        ))}
       </ul>
      )}
     </section>

     <section className="px-5 py-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider
 text-[#8b939e] mb-3">
       <Package className="w-3.5 h-3.5" />
       Parts at station
      </h3>
      {sessions.length === 0 ? (
       <p className="text-sm text-[#8b939e]">No parts currently at this station</p>
      ) : (
       <div className="space-y-3">
        {sessions.map(session => (
         <div
          key={session.session_id ?? session.id}
          className="rounded-lg border border-[#27272f]
 bg-[#08080a]/80 bg-[#18181d]/50 overflow-hidden"
         >
          <div className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2
 border-b border-[#27272f]/80 border-[#27272f]/60">
           <span className="text-sm font-mono font-semibold text-[#eef2f7]">
            {partLabel(session)}
           </span>
           <StatusBadge status={session.status} />
          </div>
          <div className="px-3 py-2 grid grid-cols-2 gap-2 text-xs">
           <div>
            <p className="text-[#8b939e] uppercase tracking-wide text-[10px]">Entered</p>
            <p className="font-mono text-[#eef2f7]">{formatTime(session.entry_time)}</p>
           </div>
           <div>
            <p className="text-[#8b939e] uppercase tracking-wide text-[10px]">Dwell</p>
            <DwellTimer
             entranceTime={session.entry_time}
             entranceEpochMs={session.entry_epoch_ms}
             exitTime={null}
             dwellSeconds={null}
            />
           </div>
          </div>
          <div className="px-3 py-2 border-t border-[#27272f]/80 border-[#27272f]/60">
           <p className="text-[10px] uppercase tracking-wide text-[#8b939e] mb-1">
            Operators on part
           </p>
           <OperatorCell session={session} liveFeed />
          </div>
         </div>
        ))}
       </div>
      )}
     </section>
    </div>
   </div>
  </div>
 )
}
