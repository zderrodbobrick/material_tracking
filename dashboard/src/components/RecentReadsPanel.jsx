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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col">
      <div className="px-5 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Recent RFID Activity</h2>
        <p className="text-xs text-gray-500 mt-0.5">Most recently seen tags — live feed</p>
      </div>

      {reads.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-gray-400">No reads yet — waiting for reader events</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Read Time</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">IBUS #</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">RSSI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reads.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap font-mono text-xs">
                    {formatTime(r.first_enter_at_ant1)}
                  </td>
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 whitespace-nowrap">
                    {r['IBUS #']}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-xs text-gray-500">
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
