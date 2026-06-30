import { Radio } from 'lucide-react'
import { StatusBadge } from './StatusBadge'

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
                    bg-white border border-gray-200
                    dark:bg-slate-800/60 dark:border-slate-700/60">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-700/60">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100">
          <Radio className="w-4 h-4 text-blue-500 dark:text-blue-400" />
          Recent RFID Activity
        </h2>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Most recently seen tags — live feed</p>
      </div>

      {reads.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-gray-400 dark:text-slate-500">No reads yet — waiting for reader events</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50 dark:bg-slate-900/40
                             border-b border-gray-200 dark:border-slate-700/60">
                {['Read Time', 'IBUS #', 'Status', 'RSSI'].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap
                                         text-gray-600 dark:text-slate-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
              {reads.map((r, i) => (
                <tr
                  key={i}
                  style={{ animationDelay: `${Math.min(i * 30, 350)}ms` }}
                  className="animate-row-in transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs
                                 text-gray-600 dark:text-slate-400">
                    {formatTime(r.first_enter_at_ant1)}
                  </td>
                  <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap
                                 text-slate-800 dark:text-slate-100">
                    {r['IBUS #']}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs text-gray-500 dark:text-slate-400">
                      {r.first_enter_rssi_ant1 != null ? `${r.first_enter_rssi_ant1} dBm` : '—'}
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
