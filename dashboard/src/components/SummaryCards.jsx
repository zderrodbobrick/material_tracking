import { useRef, useEffect, useState } from 'react'
import { Activity, CheckCircle, Clock, AlertTriangle, Radio, Wifi } from 'lucide-react'

function Card({ title, value, icon: Icon, accent, index }) {
  const isNumber = typeof value === 'number'
  const [pop, setPop] = useState(false)
  const prev = useRef(value)

  useEffect(() => {
    if (prev.current !== value && prev.current !== undefined) {
      setPop(true)
      const id = setTimeout(() => setPop(false), 420)
      prev.current = value
      return () => clearTimeout(id)
    }
    prev.current = value
  }, [value])

  return (
    <div
      style={{ animationDelay: `${index * 60}ms` }}
      className="group animate-fade-in-scale rounded-xl p-4 flex flex-col gap-3
                 bg-white border border-gray-200 shadow-sm
                 dark:bg-slate-800/60 dark:border-slate-700/60
                 hover:shadow-lg hover:-translate-y-1 hover:border-gray-300
                 dark:hover:border-slate-600
                 transition-[transform,box-shadow,border-color] duration-300"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider leading-none
                      text-gray-500 dark:text-slate-400">
          {title}
        </p>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center
                         transition-transform duration-300 group-hover:scale-110
                         ${accent.iconBg}`}>
          <Icon className={`w-4 h-4 ${accent.iconColor}`} />
        </div>
      </div>
      <p
        className={`font-bold leading-tight break-words ${accent.value}
                    ${isNumber ? 'text-4xl tabular-nums' : 'text-base'}
                    ${pop ? 'animate-value-pop' : ''}`}
      >
        {value ?? '—'}
      </p>
    </div>
  )
}

function SkeletonCard({ index }) {
  return (
    <div
      style={{ animationDelay: `${index * 60}ms` }}
      className="animate-fade-in-scale rounded-xl p-4 flex flex-col gap-3
                 bg-white border border-gray-200 shadow-sm
                 dark:bg-slate-800/60 dark:border-slate-700/60"
    >
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded bg-gray-200 dark:bg-slate-700 animate-pulse" />
        <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-slate-700 animate-pulse" />
      </div>
      <div className="h-8 w-16 rounded bg-gray-200 dark:bg-slate-700 animate-pulse" />
    </div>
  )
}

function readerAccent(status) {
  if (status === 'Active') {
    return {
      iconBg: 'bg-green-50 dark:bg-green-500/10',
      iconColor: 'text-green-600 dark:text-green-400',
      value: 'text-green-700 dark:text-green-400',
    }
  }
  if (status === 'No Recent Reads') {
    return {
      iconBg: 'bg-yellow-50 dark:bg-yellow-500/10',
      iconColor: 'text-yellow-600 dark:text-yellow-400',
      value: 'text-yellow-700 dark:text-yellow-400',
    }
  }
  return {
    iconBg: 'bg-slate-50 dark:bg-slate-700/40',
    iconColor: 'text-slate-500 dark:text-slate-400',
    value: 'text-slate-700 dark:text-slate-300',
  }
}

export function SummaryCards({ summary }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} index={i} />)}
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

  const alertsActive = summary.active_alerts > 0

  const cards = [
    {
      title: 'Parts In Process',
      value: summary.parts_in_process,
      icon: Activity,
      accent: {
        iconBg: 'bg-blue-50 dark:bg-blue-500/10',
        iconColor: 'text-blue-600 dark:text-blue-400',
        value: 'text-blue-700 dark:text-blue-400',
      },
    },
    {
      title: 'Completed Today',
      value: summary.completed_today,
      icon: CheckCircle,
      accent: {
        iconBg: 'bg-green-50 dark:bg-green-500/10',
        iconColor: 'text-green-600 dark:text-green-400',
        value: 'text-green-700 dark:text-green-400',
      },
    },
    {
      title: 'Avg Dwell Today',
      value: summary.average_dwell_display_today ?? '—',
      icon: Clock,
      accent: {
        iconBg: 'bg-violet-50 dark:bg-violet-500/10',
        iconColor: 'text-violet-600 dark:text-violet-400',
        value: 'text-violet-700 dark:text-violet-300',
      },
    },
    {
      title: 'Active Alerts',
      value: summary.active_alerts,
      icon: AlertTriangle,
      accent: alertsActive
        ? {
            iconBg: 'bg-red-50 dark:bg-red-500/10',
            iconColor: 'text-red-500 dark:text-red-400',
            value: 'text-red-600 dark:text-red-400',
          }
        : {
            iconBg: 'bg-gray-50 dark:bg-slate-700/40',
            iconColor: 'text-gray-400 dark:text-slate-500',
            value: 'text-gray-500 dark:text-slate-400',
          },
    },
    {
      title: 'Last RFID Read',
      value: lastReadStr,
      icon: Radio,
      accent: {
        iconBg: 'bg-slate-50 dark:bg-slate-700/40',
        iconColor: 'text-slate-500 dark:text-slate-400',
        value: 'text-slate-700 dark:text-slate-300',
      },
    },
    {
      title: 'Reader Status',
      value: summary.reader_status ?? '—',
      icon: Wifi,
      accent: readerAccent(summary.reader_status),
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((c, i) => <Card key={c.title} index={i} {...c} />)}
    </div>
  )
}
