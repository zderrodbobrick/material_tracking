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
   className="group animate-fade-in-scale bb-card flex flex-col gap-3"
  >
   <div className="flex items-center justify-between">
    <p className="bb-kpi-label">{title}</p>
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
   className="animate-fade-in-scale bb-card flex flex-col gap-3"
  >
   <div className="flex items-center justify-between">
    <div className="h-3 w-24 rounded bg-[#27272f] animate-pulse" />
    <div className="w-9 h-9 rounded-lg bg-[#27272f] animate-pulse" />
   </div>
   <div className="h-8 w-16 rounded bg-[#27272f] animate-pulse" />
  </div>
 )
}

function readerAccent(status) {
 if (status === 'Active') {
  return {
   iconBg: 'bg-[#34d399]/10',
   iconColor: 'text-[#34d399]',
   value: 'text-[#34d399]',
  }
 }
 if (status === 'No Recent Reads') {
  return {
   iconBg: 'bg-[#fbbf24]/10',
   iconColor: 'text-[#fbbf24]',
   value: 'text-[#fbbf24]',
  }
 }
 return {
  iconBg: 'bg-[#18181d]/5',
  iconColor: 'text-[#8b939e]',
  value: 'text-[#eef2f7]',
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
    iconBg: 'bg-[#4dc4f4]/10',
    iconColor: 'text-[#4dc4f4]',
    value: 'text-[#4dc4f4]',
   },
  },
  {
   title: 'Completed Today',
   value: summary.completed_today,
   icon: CheckCircle,
   accent: {
    iconBg: 'bg-[#34d399]/10',
    iconColor: 'text-[#34d399]',
    value: 'text-[#34d399]',
   },
  },
  {
   title: 'Avg Dwell Today',
   value: summary.average_dwell_display_today ?? '—',
   icon: Clock,
   accent: {
    iconBg: 'bg-[#4dc4f4]/10',
    iconColor: 'text-[#4dc4f4]',
    value: 'text-[#eef2f7]',
   },
  },
  {
   title: 'Active Alerts',
   value: summary.active_alerts,
   icon: AlertTriangle,
   accent: alertsActive
    ? {
      iconBg: 'bg-[#f87171]/10',
      iconColor: 'text-[#f87171]',
      value: 'text-[#f87171]',
     }
    : {
      iconBg: 'bg-[#18181d]/5',
      iconColor: 'text-[#8b939e]',
      value: 'text-[#8b939e]',
     },
  },
  {
   title: 'Last RFID Read',
   value: lastReadStr,
   icon: Radio,
   accent: {
    iconBg: 'bg-[#18181d]/5',
    iconColor: 'text-[#8b939e]',
    value: 'text-[#eef2f7]',
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
