import { Radio, ArrowRight, Activity, CheckCircle, Wifi } from 'lucide-react'

function Chip({ icon: Icon, label, value, color }) {
 return (
  <div className="flex items-center gap-3 rounded-xl px-4 py-3 backdrop-blur-md
 bg-[#18181d]/80 border border-[#27272f] shadow-lg">
   <span className={`flex items-center justify-center w-9 h-9 rounded-lg ${color}`}>
    <Icon className="w-4 h-4" />
   </span>
   <div className="text-left">
    <p className="text-[11px] uppercase tracking-wide text-[#8b939e] leading-none">{label}</p>
    <p className="text-lg font-bold text-[#eef2f7] leading-tight mt-0.5">{value ?? '—'}</p>
   </div>
  </div>
 )
}

export function LandingPage({ summary, wsStatus, onEnter }) {
 const readerLive = summary?.reader_status === 'Active'

 return (
  <div className="relative min-h-screen overflow-hidden flex items-center justify-center
 bg-gradient-to-br from-[#08080a] via-[#111114] to-[#08080a] text-white">
   <div className="pointer-events-none absolute inset-0 opacity-[0.12] animate-grid-drift"
      style={{
       backgroundImage:
        'linear-gradient(to right, rgba(77,196,244,0.25) 1px, transparent 1px),' +
        'linear-gradient(to bottom, rgba(77,196,244,0.25) 1px, transparent 1px)',
       backgroundSize: '40px 40px',
      }} />
   <div className="pointer-events-none absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full
 bg-[#4dc4f4]/10 blur-3xl" />
   <div className="pointer-events-none absolute -bottom-40 -right-40 w-[36rem] h-[36rem] rounded-full
 bg-[#0099cc]/10 blur-3xl" />

   <div className="absolute top-0 inset-x-0 flex items-center justify-between px-6 py-5 z-20">
    <img src="/bobrick-logo.png" alt="Bobrick"
       className="h-10 w-auto rounded-lg bg-white p-1.5 shadow-md" />
   </div>

   <div className="relative z-10 px-6 w-full max-w-2xl mx-auto text-center">
    <div className="animate-float-up mx-auto mb-8 relative w-28 h-28">
     <span className="absolute inset-0 rounded-full border border-[#4dc4f4]/30" />
     <span className="absolute inset-3 rounded-full border border-[#4dc4f4]/20" />
     <span className="absolute inset-0 rounded-full bg-[#4dc4f4]/15 animate-ping-slow" />
     <span className="absolute inset-0 rounded-full overflow-hidden animate-radar-sweep">
      <span className="absolute top-1/2 left-1/2 h-1/2 w-1/2 origin-top-left
 bg-gradient-to-r from-[#4dc4f4]/50 to-transparent" />
     </span>
     <span className="absolute inset-0 flex items-center justify-center">
      <Radio className="w-10 h-10 text-[#4dc4f4]" />
     </span>
    </div>

    <p className="animate-float-up text-sm font-semibold tracking-[0.25em] text-[#4dc4f4]/80 uppercase"
      style={{ animationDelay: '80ms' }}>
     Bobrick Washroom Equipment
    </p>
    <h1 className="animate-float-up mt-3 text-5xl sm:text-6xl font-extrabold tracking-tight
 bg-gradient-to-r from-white via-[#4dc4f4]/90 to-[#8b939e] bg-clip-text text-transparent
            pb-2 leading-tight"
      style={{ animationDelay: '140ms' }}>
     RFID Tracking System
    </h1>
    <p className="animate-float-up mt-4 text-lg text-[#8b939e] max-w-xl mx-auto"
      style={{ animationDelay: '200ms' }}>
     Real-time part tracking, dwell-time monitoring, and production analytics
     across Gannomat and Insert Station.
    </p>

    <button
     onClick={onEnter}
     className="animate-float-up group mt-10 inline-flex items-center gap-2.5 rounded-full
 px-8 py-4 text-base font-semibold text-[#08080a] shadow-xl
           bg-[#4dc4f4] hover:bg-[#6dd0f7]
           hover:shadow-[#4dc4f4]/30 hover:scale-[1.03]
           active:scale-95 transition-all duration-300
           focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4dc4f4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]"
     style={{ animationDelay: '260ms' }}
    >
     Enter Dashboard
     <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
    </button>

    <div className="animate-float-up mt-12 grid grid-cols-1 sm:grid-cols-3 gap-3"
       style={{ animationDelay: '340ms' }}>
     <Chip icon={Activity} label="Parts In Process"
        value={summary?.parts_in_process}
        color="bg-[#4dc4f4]/15 text-[#4dc4f4]" />
     <Chip icon={CheckCircle} label="Completed Today"
        value={summary?.completed_today}
        color="bg-[#34d399]/15 text-[#34d399]" />
     <Chip icon={Wifi} label="Reader"
        value={summary?.reader_status ?? (wsStatus === 'live' ? 'Connected' : 'Offline')}
        color={readerLive ? 'bg-[#34d399]/15 text-[#34d399]' : 'bg-[#18181d]/5 text-[#8b939e]'} />
    </div>
   </div>
  </div>
 )
}
