import { useState, useEffect } from 'react'
import { Radio, LayoutDashboard, FileBarChart, LineChart, Home, CheckCircle, Users, Settings } from 'lucide-react'

const TABS = [
 { id: 'live',   label: 'Live Dashboard', icon: LayoutDashboard },
 { id: 'completed', label: 'Completed IBUS', icon: CheckCircle },
 { id: 'report',  label: 'Full Report',  icon: FileBarChart },
 { id: 'analytics', label: 'Analytics',   icon: LineChart },
 { id: 'operators', label: 'Operators',   icon: Users },
 { id: 'settings', label: 'Settings',    icon: Settings },
]

function NavTabs({ activeTab, onTabChange }) {
 return (
  <nav className="flex items-center gap-1">
   {TABS.map(t => {
    const Icon = t.icon
    const active = activeTab === t.id
    return (
     <button
      key={t.id}
      onClick={() => onTabChange(t.id)}
      className={`group relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium
            transition-all duration-200
            ${active
             ? 'bg-[#18181d]/15 text-white shadow-sm'
             : 'text-[#8b939e] hover:text-white hover:bg-[#18181d]/10'}`}
     >
      <Icon className={`w-4 h-4 ${active ? 'text-[#4dc4f4]' : 'text-[#8b939e] group-hover:text-[#eef2f7]'}`} />
      <span className="hidden sm:inline">{t.label}</span>
      {active && (
       <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-[#4dc4f4]" />
      )}
     </button>
    )
   })}
  </nav>
 )
}

function ConnectionIndicator({ status }) {
 const config = {
  live: {
   dot: 'bg-green-400',
   text: 'text-green-300',
   label: 'Live',
   ring: true,
  },
  reconnecting: {
   dot: 'bg-yellow-400 animate-pulse',
   text: 'text-yellow-300',
   label: 'Reconnecting',
  },
  connecting: {
   dot: 'bg-slate-400 animate-pulse',
   text: 'text-[#8b939e]',
   label: 'Connecting',
  },
  offline: {
   dot: 'bg-red-500',
   text: 'text-red-300',
   label: 'Offline',
  },
 }
 const c = config[status] ?? config.offline

 return (
  <span
   className={`flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full
         bg-[#18181d]/10 backdrop-blur-sm ${c.text}`}
  >
   <span className={`w-2 h-2 rounded-full ${c.dot} ${c.ring ? 'animate-pulse-ring' : ''}`} />
   {c.label}
  </span>
 )
}

export function Header({ wsStatus, lastUpdated, activeTab, onTabChange, onHome }) {
 const [now, setNow] = useState(new Date())

 useEffect(() => {
  const id = setInterval(() => setNow(new Date()), 1000)
  return () => clearInterval(id)
 }, [])

 const timeOpts = { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }
 const clockStr = now.toLocaleTimeString('en-US', timeOpts)
 const updatedStr = lastUpdated ? lastUpdated.toLocaleTimeString('en-US', timeOpts) : '—'

 return (
  <header
   className="sticky top-0 z-50 animate-slide-down border-b border-[#27272f]
 bg-gradient-to-r from-[#08080a] via-[#111114] to-[#08080a]
         text-white shadow-lg shadow-black/40 backdrop-blur-md"
  >
   <div className="w-full px-3 sm:px-4 py-3.5 flex items-center justify-between gap-4">
    <div className="flex items-center gap-4 min-w-0">
     <button onClick={onHome} title="Back to home"
         className="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4dc4f4]">
      <img
       src="/bobrick-logo.png"
       alt="Bobrick — Building Value Since 1906"
       className="h-11 w-auto rounded-lg bg-white p-1.5 shadow-md transition-transform hover:scale-105"
      />
     </button>
     <div className="h-9 w-px bg-white/15 hidden sm:block" />
     <div className="flex items-center gap-2.5 min-w-0">
      <span className="relative flex items-center justify-center w-9 h-9 rounded-lg shrink-0
 bg-[#4dc4f4]/15 ring-1 ring-[#4dc4f4]/30">
       <Radio className="w-5 h-5 text-[#4dc4f4]" />
       <span className="absolute inset-0 rounded-lg animate-pulse-ring opacity-60" />
      </span>
      <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-[#4dc4f4]/80
 bg-clip-text text-transparent truncate hidden md:block">
       RFID Tracking System
      </h1>
     </div>
    </div>

    <div className="flex items-center gap-4 shrink-0">
     <div className="hidden lg:flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-3">
       <span className="text-[#8b939e] text-xs">
        Updated: <span className="text-[#eef2f7] font-mono">{updatedStr}</span>
       </span>
       <ConnectionIndicator status={wsStatus} />
      </div>
      <p className="text-[#8b939e] text-xs font-mono tabular-nums">{clockStr}</p>
     </div>
     <div className="lg:hidden">
      <ConnectionIndicator status={wsStatus} />
     </div>
    </div>
   </div>

   {/* Navigation row */}
   <div className="border-t border-white/10 bg-black/10">
    <div className="w-full px-3 sm:px-4">
     <div className="flex items-center gap-1 py-1.5 overflow-x-auto">
      <button onClick={onHome} title="Home"
          className="flex items-center justify-center w-9 h-9 rounded-lg text-[#8b939e]
 hover:text-white hover:bg-[#18181d]/10 transition-colors shrink-0">
       <Home className="w-4 h-4" />
      </button>
      <span className="h-5 w-px bg-[#18181d]/10 mx-1 shrink-0" />
      <NavTabs activeTab={activeTab} onTabChange={onTabChange} />
     </div>
    </div>
   </div>
  </header>
 )
}
