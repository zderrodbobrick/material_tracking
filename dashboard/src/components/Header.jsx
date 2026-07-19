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
  <nav className="flex items-center gap-0.5">
   {TABS.map(t => {
    const Icon = t.icon
    const active = activeTab === t.id
    return (
     <button
      key={t.id}
      onClick={() => onTabChange(t.id)}
      className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-[6px] text-sm font-medium
            transition-colors
            ${active
             ? 'bg-[#16161a] text-white'
             : 'text-[#8b939e] hover:text-white hover:bg-[#16161a]/60'}`}
     >
      <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#4dc4f4]' : 'text-[#8b939e] group-hover:text-[#eef2f7]'}`} />
      <span className="hidden sm:inline">{t.label}</span>
      {active && (
       <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-[#4dc4f4]" />
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
   dot: 'bg-[#34d399]',
   text: 'text-[#34d399]',
   label: 'Live',
   ring: true,
  },
  reconnecting: {
   dot: 'bg-[#fbbf24] animate-pulse',
   text: 'text-[#fbbf24]',
   label: 'Reconnecting',
  },
  connecting: {
   dot: 'bg-[#8b939e] animate-pulse',
   text: 'text-[#8b939e]',
   label: 'Connecting',
  },
  offline: {
   dot: 'bg-[#f87171]',
   text: 'text-[#f87171]',
   label: 'Offline',
  },
 }
 const c = config[status] ?? config.offline

 return (
  <span className={`flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
   <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${c.ring ? 'animate-pulse-ring' : ''}`} />
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
  <header className="sticky top-0 z-50 border-b border-[#2a2a32] bg-[#08080a] text-white">
   <div className="w-full px-3 sm:px-4 py-2.5 flex items-center justify-between gap-4">
    <div className="flex items-center gap-3 min-w-0">
     <button onClick={onHome} title="Back to home"
         className="shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4dc4f4] rounded-[6px]">
      <img
       src="/bobrick-logo.png"
       alt="Bobrick — Building Value Since 1906"
       className="h-9 w-auto rounded-[4px] bg-white p-1"
      />
     </button>
     <div className="h-7 w-px bg-[#2a2a32] hidden sm:block" />
     <div className="flex items-center gap-2 min-w-0">
      <Radio className="w-4 h-4 text-[#4dc4f4] shrink-0" />
      <h1 className="text-sm font-semibold text-[#eef2f7] truncate hidden md:block">
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

   <div className="border-t border-[#2a2a32]">
    <div className="w-full px-3 sm:px-4">
     <div className="flex items-center gap-1 py-1 overflow-x-auto">
      <button onClick={onHome} title="Home"
          className="flex items-center justify-center w-8 h-8 rounded-[6px] text-[#8b939e]
 hover:text-white hover:bg-[#16161a] transition-colors shrink-0">
       <Home className="w-3.5 h-3.5" />
      </button>
      <span className="h-4 w-px bg-[#2a2a32] mx-1 shrink-0" />
      <NavTabs activeTab={activeTab} onTabChange={onTabChange} />
     </div>
    </div>
   </div>
  </header>
 )
}
