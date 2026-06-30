const STATUS_STYLES = {
  // Legacy tag_reads statuses
  IN_PROGRESS:        'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  COMPLETE:           'bg-green-100 text-green-800 border border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30',
  ABANDONED:          'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/50',
  EXIT_ONLY:          'bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  // station_sessions statuses
  'In Process':       'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  'Completed':        'bg-green-100 text-green-800 border border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30',
  'Abandoned':        'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/50',
  'Missing Exit':     'bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  'Missing Entrance': 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
  // rfid_events antenna locations
  'Entrance':         'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  'Exit':             'bg-green-100 text-green-800 border border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30',
}

const FALLBACK = 'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/50'

const STATUS_LABELS = {
  IN_PROGRESS:        'In Process',
  COMPLETE:           'Completed',
  ABANDONED:          'Abandoned',
  EXIT_ONLY:          'Exit Only',
  'In Process':       'In Process',
  'Completed':        'Completed',
  'Abandoned':        'Abandoned',
  'Missing Exit':     'Missing Exit',
  'Missing Entrance': 'Missing Entrance',
  'Entrance':         'Entrance',
  'Exit':             'Exit',
}

export function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? FALLBACK
  const label = STATUS_LABELS[status] ?? status
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${style}`}>
      {label}
    </span>
  )
}
