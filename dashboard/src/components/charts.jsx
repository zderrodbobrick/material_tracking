/**
 * Lightweight, dependency-free charts (SVG + flex bars), Bobrick-themed.
 */

const BOBRICK_BAR = 'bg-[#4dc4f4]/90 group-hover/bar:bg-[#4dc4f4]'
const BOBRICK_GRAD = 'from-[#4dc4f4] to-[#0099cc]'

/* ── Vertical bar chart ─────────────────────────────────────────────────────── */
export function VerticalBars({ data, formatValue = v => v, highlightIndex = -1, accent = 'bobrick' }) {
 const max = Math.max(1, ...data.map(d => d.value))
 const barColor = {
  blue: BOBRICK_BAR,
  violet: BOBRICK_BAR,
  green: 'bg-[#34d399]/90 group-hover/bar:bg-[#34d399]',
  bobrick: BOBRICK_BAR,
 }[accent] ?? BOBRICK_BAR

 return (
  <div className="flex items-end gap-1 h-48 w-full">
   {data.map((d, i) => {
    const pct = (d.value / max) * 100
    const isHi = i === highlightIndex
    return (
     <div key={i} className="group/bar relative flex-1 flex flex-col items-center justify-end h-full">
      <div className="opacity-0 group-hover/bar:opacity-100 transition-opacity absolute -top-1
 -translate-y-full z-10 px-2 py-1 rounded-md text-xs whitespace-nowrap
              bg-[#18181d] text-[#eef2f7] border border-[#27272f] shadow-lg pointer-events-none">
       {d.label}: <span className="font-semibold">{formatValue(d.value)}</span>
      </div>
      <div
       style={{ height: `${Math.max(pct, d.value > 0 ? 4 : 0)}%` }}
       className={`w-full rounded-t-sm transition-all duration-500
             ${isHi ? 'bg-[#fbbf24]' : barColor}
             ${d.value === 0 ? 'min-h-[2px] bg-[#27272f]' : ''}`}
      />
      <span className="mt-1.5 text-[10px] leading-none text-[#8b939e] tabular-nums">
       {d.short ?? d.label}
      </span>
     </div>
    )
   })}
  </div>
 )
}

/* ── Horizontal bar list ────────────────────────────────────────────────────── */
export function HorizontalBars({ data, formatValue = v => v, accent = 'bobrick', emptyText = 'No data' }) {
 if (!data || data.length === 0) {
  return <p className="text-sm text-[#8b939e] py-8 text-center">{emptyText}</p>
 }
 const max = Math.max(1, ...data.map(d => d.value))
 const barColor = {
  blue: BOBRICK_GRAD,
  violet: BOBRICK_GRAD,
  green: 'from-[#34d399] to-[#10b981]',
  amber: 'from-[#fbbf24] to-[#f59e0b]',
  bobrick: BOBRICK_GRAD,
 }[accent] ?? BOBRICK_GRAD

 return (
  <div className="space-y-3">
   {data.map((d, i) => {
    const pct = (d.value / max) * 100
    return (
     <div key={i} className="group">
      <div className="flex items-center justify-between mb-1 text-sm">
       <span className="font-medium text-[#eef2f7] truncate pr-2">{d.label}</span>
       <span className="font-mono font-semibold tabular-nums text-[#4dc4f4] shrink-0">
        {d.display ?? formatValue(d.value)}
       </span>
      </div>
      <div className="h-2.5 rounded-full bg-[#27272f] overflow-hidden">
       <div
        style={{ width: `${Math.max(pct, d.value > 0 ? 3 : 0)}%`, transitionDelay: `${i * 40}ms` }}
        className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-700`}
       />
      </div>
     </div>
    )
   })}
  </div>
 )
}

/* ── Area / line chart (SVG) ────────────────────────────────────────────────── */
export function AreaChart({ data, formatValue = v => v }) {
 const W = 600
 const H = 180
 const PAD = 8
 const max = Math.max(1, ...data.map(d => d.value))
 const n = data.length
 const stepX = n > 1 ? (W - PAD * 2) / (n - 1) : 0
 const y = v => H - PAD - (v / max) * (H - PAD * 2)
 const x = i => PAD + i * stepX

 const linePts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')
 const areaPts = `${PAD},${H - PAD} ${linePts} ${x(n - 1)},${H - PAD}`

 return (
  <div className="w-full">
   <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44 text-[#4dc4f4]" preserveAspectRatio="none">
    <defs>
     <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#4dc4f4" stopOpacity="0.28" />
      <stop offset="100%" stopColor="#4dc4f4" stopOpacity="0" />
     </linearGradient>
    </defs>
    <polygon points={areaPts} fill="url(#areaFill)" />
    <polyline
     points={linePts}
     fill="none"
     strokeWidth="2.5"
     strokeLinejoin="round"
     strokeLinecap="round"
     stroke="#4dc4f4"
    />
    {data.map((d, i) => (
     <g key={i} className="group/pt">
      <circle cx={x(i)} cy={y(d.value)} r="3.5" fill="#4dc4f4" />
      <circle cx={x(i)} cy={y(d.value)} r="14" fill="transparent" />
      <title>{`${d.label}: ${formatValue(d.value)}`}</title>
     </g>
    ))}
   </svg>
   <div className="flex justify-between mt-1 text-[10px] text-[#8b939e]">
    {data.map((d, i) => (
     <span key={i} className={n > 8 && i % 2 !== 0 ? 'opacity-0' : ''}>{d.short ?? d.label}</span>
    ))}
   </div>
  </div>
 )
}

/* ── Donut (status mix) ─────────────────────────────────────────────────────── */
export function Donut({ segments, centerLabel, centerValue }) {
 const total = segments.reduce((s, x) => s + x.value, 0) || 1
 const R = 54
 const C = 2 * Math.PI * R
 let offset = 0

 return (
  <div className="flex items-center gap-5">
   <div className="relative shrink-0">
    <svg viewBox="0 0 140 140" className="w-32 h-32 -rotate-90">
     <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" stroke="#27272f" />
     {segments.map((s, i) => {
      const len = (s.value / total) * C
      const seg = (
       <circle
        key={i} cx="70" cy="70" r={R} fill="none" strokeWidth="16"
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-offset}
        className={`${s.stroke} transition-all duration-700`}
        strokeLinecap="butt"
       />
      )
      offset += len
      return seg
     })}
    </svg>
    <div className="absolute inset-0 flex flex-col items-center justify-center -rotate-0">
     <span className="text-2xl font-bold tabular-nums text-[#eef2f7]">{centerValue}</span>
     <span className="text-[10px] uppercase tracking-wide text-[#8b939e]">{centerLabel}</span>
    </div>
   </div>
   <div className="space-y-1.5 min-w-0">
    {segments.map((s, i) => (
     <div key={i} className="flex items-center gap-2 text-sm">
      <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${s.dot}`} />
      <span className="text-[#8b939e] truncate">{s.label}</span>
      <span className="ml-auto font-mono font-semibold text-[#eef2f7]">{s.value}</span>
     </div>
    ))}
   </div>
  </div>
 )
}
