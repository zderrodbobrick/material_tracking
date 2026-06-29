const STATUS_STYLES = {
  IN_PROGRESS: 'bg-blue-100 text-blue-800 border border-blue-200',
  COMPLETE:    'bg-green-100 text-green-800 border border-green-200',
  ABANDONED:   'bg-gray-100 text-gray-600 border border-gray-200',
  EXIT_ONLY:   'bg-orange-100 text-orange-800 border border-orange-200',
}

const STATUS_LABELS = {
  IN_PROGRESS: 'In Process',
  COMPLETE:    'Completed',
  ABANDONED:   'Abandoned',
  EXIT_ONLY:   'Exit Only',
}

export function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600 border border-gray-200'
  const label = STATUS_LABELS[status] ?? status
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${style}`}>
      {label}
    </span>
  )
}
