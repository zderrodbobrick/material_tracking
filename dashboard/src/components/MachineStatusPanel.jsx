import { Factory } from 'lucide-react'
import { DwellTimer } from './DwellTimer'

const LIGHT_STYLES = {
  green: {
    dot: 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.7)]',
    ping: 'bg-green-400',
    title: 'In use — part and operator',
  },
  amber: {
    dot: 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]',
    ping: 'bg-amber-400',
    title: 'Part at station — no operator',
  },
  out: {
    dot: 'bg-slate-400 dark:bg-slate-500 shadow-[0_0_4px_rgba(100,116,139,0.5)]',
    ping: 'bg-slate-300 dark:bg-slate-400',
    title: 'Out of use — no part',
  },
  idle: {
    dot: 'bg-gray-300 dark:bg-slate-600 ring-1 ring-gray-200 dark:ring-slate-500',
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
    return <span className="text-gray-400 dark:text-slate-500">—</span>
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
                    bg-white border border-gray-200
                    dark:bg-slate-800/60 dark:border-slate-700/60 w-full">
      <div className="px-4 py-3.5 border-b border-gray-200 dark:border-slate-700/60 shrink-0">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100">
            <Factory className="w-5 h-5 text-emerald-500 dark:text-emerald-400 shrink-0" />
            <span className="truncate">Machine Status</span>
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            {statuses.length} stations · {inUseCount} in use · {outOfUseCount} out of use
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          className={`grid ${COLS} gap-x-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide
                      text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-900/80
                      border-b border-gray-200 dark:border-slate-700/60 shrink-0`}
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
                          border-b border-gray-100 dark:border-slate-700/40 text-sm
                          transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30
                          ${row.inUse ? '' : row.hasPart ? '' : 'opacity-80'}`}
            >
              <StatusLight light={row.light} />
              <span className="font-semibold text-gray-900 dark:text-slate-100 truncate" title={row.stationName}>
                {row.stationName}
              </span>
              <span className="text-gray-700 dark:text-slate-300 truncate" title={row.partLabel ?? undefined}>
                {row.partLabel ?? '—'}
              </span>
              <span className="whitespace-nowrap">
                <DwellCell
                  entranceTime={row.partEntryTime}
                  entranceEpochMs={row.partEntryEpochMs}
                />
              </span>
              <span className="text-gray-700 dark:text-slate-300 truncate" title={row.operatorName ?? undefined}>
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
