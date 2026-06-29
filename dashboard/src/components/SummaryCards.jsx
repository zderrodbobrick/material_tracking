import { Activity, CheckCircle, Clock, AlertTriangle, Radio, Wifi } from 'lucide-react'

function Card({ title, value, icon: Icon, iconBgClass, iconColorClass, valueColorClass }) {
  const isNumber = typeof value === 'number'
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider leading-none">
          {title}
        </p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBgClass}`}>
          <Icon className={`w-4 h-4 ${iconColorClass}`} />
        </div>
      </div>
      <p
        className={`font-bold leading-tight break-words ${valueColorClass} ${
          isNumber ? 'text-4xl' : 'text-base'
        }`}
      >
        {value ?? '—'}
      </p>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-col gap-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 bg-gray-200 rounded" />
        <div className="w-8 h-8 bg-gray-200 rounded-lg" />
      </div>
      <div className="h-8 w-16 bg-gray-200 rounded" />
    </div>
  )
}

function readerColor(status) {
  if (status === 'Active') return 'text-green-600'
  if (status === 'No Recent Reads') return 'text-yellow-600'
  return 'text-gray-500'
}

export function SummaryCards({ summary }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  const lastReadStr = summary.last_rfid_read_time
    ? new Date(summary.last_rfid_read_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    : 'Never'

  const cards = [
    {
      title: 'Parts In Process',
      value: summary.parts_in_process,
      icon: Activity,
      iconBgClass: 'bg-blue-50',
      iconColorClass: 'text-blue-600',
      valueColorClass: 'text-blue-700',
    },
    {
      title: 'Completed Today',
      value: summary.completed_today,
      icon: CheckCircle,
      iconBgClass: 'bg-green-50',
      iconColorClass: 'text-green-600',
      valueColorClass: 'text-green-700',
    },
    {
      title: 'Avg Dwell Today',
      value: summary.average_dwell_display_today ?? '—',
      icon: Clock,
      iconBgClass: 'bg-slate-50',
      iconColorClass: 'text-slate-600',
      valueColorClass: 'text-slate-700',
    },
    {
      title: 'Active Alerts',
      value: summary.active_alerts,
      icon: AlertTriangle,
      iconBgClass: summary.active_alerts > 0 ? 'bg-red-50' : 'bg-gray-50',
      iconColorClass: summary.active_alerts > 0 ? 'text-red-500' : 'text-gray-400',
      valueColorClass: summary.active_alerts > 0 ? 'text-red-600' : 'text-gray-500',
    },
    {
      title: 'Last RFID Read',
      value: lastReadStr,
      icon: Radio,
      iconBgClass: 'bg-slate-50',
      iconColorClass: 'text-slate-500',
      valueColorClass: 'text-slate-700',
    },
    {
      title: 'Reader Status',
      value: summary.reader_status ?? '—',
      icon: Wifi,
      iconBgClass: 'bg-slate-50',
      iconColorClass: readerColor(summary.reader_status),
      valueColorClass: readerColor(summary.reader_status),
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map(c => <Card key={c.title} {...c} />)}
    </div>
  )
}
