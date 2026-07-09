import { Factory, X } from 'lucide-react'

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
      className={`relative flex shrink-0 w-2.5 h-2.5 rounded-full ${style.dot}`}
      title={style.title}
    >
      {style.ping && (
        <span className={`absolute inset-0 rounded-full animate-ping opacity-40 ${style.ping}`} />
      )}
    </span>
  )
}

export function MachineStatusTable({ statuses, onClose }) {
  const inUseCount = statuses.filter(s => s.inUse).length
  const outOfUseCount = statuses.filter(s => !s.inUse && !s.hasPart).length

  return (
    <div className="animate-fade-in rounded-xl shadow-sm overflow-hidden h-full flex flex-col
                    bg-white border border-gray-200
                    dark:bg-slate-800/60 dark:border-slate-700/60 w-full">
      <div className="px-3 py-3 border-b border-gray-200 dark:border-slate-700/60 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100">
              <Factory className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
              <span className="truncate">Machine Status</span>
            </h2>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {statuses.length} shown · {inUseCount} in use · {outOfUseCount} out of use
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100
                         dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-700
                         transition-colors shrink-0"
              aria-label="Hide all machines"
              title="Hide all"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden flex-1 min-h-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left bg-gray-50 dark:bg-slate-900/40
                           border-b border-gray-200 dark:border-slate-700/60">
              {['', 'Station', 'Part', 'Operator'].map((h, i) => (
                <th
                  key={i}
                  className="px-2.5 py-2 font-semibold whitespace-nowrap text-gray-600 dark:text-slate-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {statuses.map(row => (
              <tr
                key={row.stationKey}
                className={`transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30
                  ${row.inUse ? '' : row.hasPart ? '' : 'opacity-80'}`}
              >
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <StatusLight light={row.light} />
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap font-semibold text-gray-900 dark:text-slate-100">
                  {row.stationName}
                </td>
                <td className="px-2.5 py-2 text-gray-700 dark:text-slate-300">
                  {row.partLabel ?? '—'}
                </td>
                <td className="px-2.5 py-2 text-gray-700 dark:text-slate-300">
                  {row.operatorName ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
