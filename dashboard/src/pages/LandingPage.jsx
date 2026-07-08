import { Radio, ArrowRight, Activity, CheckCircle, Wifi } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'

function Chip({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3 backdrop-blur-md
                    bg-white/5 border border-white/10 shadow-lg">
      <span className={`flex items-center justify-center w-9 h-9 rounded-lg ${color}`}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="text-left">
        <p className="text-[11px] uppercase tracking-wide text-slate-400 leading-none">{label}</p>
        <p className="text-lg font-bold text-white leading-tight mt-0.5">{value ?? '—'}</p>
      </div>
    </div>
  )
}

export function LandingPage({ summary, wsStatus, onEnter, isDark, onToggleTheme }) {
  const readerLive = summary?.reader_status === 'Active'

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center
                    bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.15] animate-grid-drift"
           style={{
             backgroundImage:
               'linear-gradient(to right, rgba(148,163,184,0.4) 1px, transparent 1px),' +
               'linear-gradient(to bottom, rgba(148,163,184,0.4) 1px, transparent 1px)',
             backgroundSize: '40px 40px',
           }} />
      <div className="pointer-events-none absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full
                      bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[36rem] h-[36rem] rounded-full
                      bg-violet-600/20 blur-3xl" />

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-6 py-5 z-20">
        <img src="/bobrick-logo.png" alt="Bobrick"
             className="h-10 w-auto rounded-lg bg-white p-1.5 shadow-md" />
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>

      {/* Center content */}
      <div className="relative z-10 px-6 w-full max-w-2xl mx-auto text-center">
        {/* Radar emblem */}
        <div className="animate-float-up mx-auto mb-8 relative w-28 h-28">
          <span className="absolute inset-0 rounded-full border border-blue-400/30" />
          <span className="absolute inset-3 rounded-full border border-blue-400/20" />
          <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping-slow" />
          <span className="absolute inset-0 rounded-full overflow-hidden animate-radar-sweep">
            <span className="absolute top-1/2 left-1/2 h-1/2 w-1/2 origin-top-left
                             bg-gradient-to-r from-blue-400/50 to-transparent" />
          </span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Radio className="w-10 h-10 text-blue-300" />
          </span>
        </div>

        <p className="animate-float-up text-sm font-semibold tracking-[0.25em] text-blue-300/80 uppercase"
           style={{ animationDelay: '80ms' }}>
          Bobrick Washroom Equipment
        </p>
        <h1 className="animate-float-up mt-3 text-5xl sm:text-6xl font-extrabold tracking-tight
                       bg-gradient-to-r from-white via-blue-100 to-slate-300 bg-clip-text text-transparent
                       pb-2 leading-tight"
            style={{ animationDelay: '140ms' }}>
          RFID Tracking System
        </h1>
        <p className="animate-float-up mt-4 text-lg text-slate-400 max-w-xl mx-auto"
           style={{ animationDelay: '200ms' }}>
          Real-time part tracking, dwell-time monitoring, and production analytics
          across Gannomat and Insert Station.
        </p>

        {/* CTA */}
        <button
          onClick={onEnter}
          className="animate-float-up group mt-10 inline-flex items-center gap-2.5 rounded-full
                     px-8 py-4 text-base font-semibold text-white shadow-xl
                     bg-gradient-to-r from-blue-600 to-violet-600
                     hover:from-blue-500 hover:to-violet-500
                     hover:shadow-blue-500/30 hover:scale-[1.03]
                     active:scale-95 transition-all duration-300
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          style={{ animationDelay: '260ms' }}
        >
          Enter Dashboard
          <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
        </button>

        {/* Live teaser stats */}
        <div className="animate-float-up mt-12 grid grid-cols-1 sm:grid-cols-3 gap-3"
             style={{ animationDelay: '340ms' }}>
          <Chip icon={Activity} label="Parts In Process"
                value={summary?.parts_in_process}
                color="bg-blue-500/20 text-blue-300" />
          <Chip icon={CheckCircle} label="Completed Today"
                value={summary?.completed_today}
                color="bg-green-500/20 text-green-300" />
          <Chip icon={Wifi} label="Reader"
                value={summary?.reader_status ?? (wsStatus === 'live' ? 'Connected' : 'Offline')}
                color={readerLive ? 'bg-green-500/20 text-green-300' : 'bg-slate-500/20 text-slate-300'} />
        </div>
      </div>
    </div>
  )
}
