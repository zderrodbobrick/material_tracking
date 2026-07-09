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
                   bg-white dark:bg-slate-900
                   border border-gray-200 dark:border-slate-700
                   animate-fade-in-scale"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4
                        border-b border-gray-200 dark:border-slate-700
                        bg-gray-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl
                             bg-violet-100 dark:bg-violet-500/15 shrink-0">
              <Factory className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </span>
            <div className="min-w-0">
              <h2 id="station-modal-title" className="text-lg font-bold text-gray-900 dark:text-slate-100 truncate">
                {machine.name}
              </h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">
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
                    ? 'text-blue-700 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
                    : pinLimitReached
                      ? 'text-gray-400 bg-gray-100 cursor-not-allowed dark:text-slate-500 dark:bg-slate-800'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700'
                  }`}
              >
                {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                {isPinned ? 'Unpin' : 'Pin queue'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-200
                         dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700
                         transition-colors shrink-0"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[calc(85vh-4.5rem)]">
          <section className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider
                           text-gray-500 dark:text-slate-400 mb-3">
              <Users className="w-3.5 h-3.5" />
              Operators in zone
            </h3>
            {operatorsInZone.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-slate-500">No operators currently in this zone</p>
            ) : (
              <ul className="space-y-2">
                {operatorsInZone.map(op => (
                  <li
                    key={op.tag_id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg
                               bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{op.operator_name}</p>
                      <p className="text-[10px] text-gray-500 dark:text-slate-400">{op.zone_name}</p>
                    </div>
                    {op.x != null && op.y != null && (
                      <span className="text-[10px] font-mono text-gray-400 dark:text-slate-500 shrink-0">
                        {Number(op.x).toFixed(1)}, {Number(op.y).toFixed(1)} m
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="px-5 py-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider
                           text-gray-500 dark:text-slate-400 mb-3">
              <Package className="w-3.5 h-3.5" />
              Parts at station
            </h3>
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-slate-500">No parts currently at this station</p>
            ) : (
              <div className="space-y-3">
                {sessions.map(session => (
                  <div
                    key={session.session_id ?? session.id}
                    className="rounded-lg border border-gray-200 dark:border-slate-700
                               bg-gray-50/80 dark:bg-slate-800/50 overflow-hidden"
                  >
                    <div className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2
                                    border-b border-gray-200/80 dark:border-slate-700/60">
                      <span className="text-sm font-mono font-semibold text-gray-900 dark:text-slate-100">
                        {partLabel(session)}
                      </span>
                      <StatusBadge status={session.status} />
                    </div>
                    <div className="px-3 py-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-gray-400 dark:text-slate-500 uppercase tracking-wide text-[10px]">Entered</p>
                        <p className="font-mono text-gray-700 dark:text-slate-300">{formatTime(session.entry_time)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 dark:text-slate-500 uppercase tracking-wide text-[10px]">Dwell</p>
                        <DwellTimer
                          entranceTime={session.entry_time}
                          entranceEpochMs={session.entry_epoch_ms}
                          exitTime={null}
                          dwellSeconds={null}
                        />
                      </div>
                    </div>
                    <div className="px-3 py-2 border-t border-gray-200/80 dark:border-slate-700/60">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1">
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
