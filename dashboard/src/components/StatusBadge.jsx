const BLUE   = 'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
const GREEN  = 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30'
const GRAY   = 'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/50'
const ORANGE = 'bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30'

const STATUS_STYLES = {
  // Normalized part_station_sessions.session_status
  open:      BLUE,
  closed:    GREEN,
  abandoned: GRAY,
  exit_only: ORANGE,
  // Antenna roles (raw reads feed)
  Entry:     BLUE,
  Exit:      GREEN,
}

const FALLBACK = GRAY

const STATUS_LABELS = {
  open:      'In Process',
  closed:    'Completed',
  abandoned: 'Abandoned',
  exit_only: 'Exit Only',
  Entry:     'Entry',
  Exit:      'Exit',
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
