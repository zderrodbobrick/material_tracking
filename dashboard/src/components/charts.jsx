/**
 * Lightweight, dependency-free charts (SVG + flex bars), Bobrick-themed.
 */

const BOBRICK_BAR = 'bg-[#4dc4f4]/90 group-hover/bar:bg-[#4dc4f4]'
const BOBRICK_GRAD = 'from-[#4dc4f4] to-[#0099cc]'

/* ── Vertical bar chart (optional peer compare bars) ────────────────────────── */
export function VerticalBars({
 data,
 compareData,
 formatValue = v => v,
 highlightIndex = -1,
 accent = 'bobrick',
 primaryLabel = 'Operator',
 compareLabel = 'Station average',
}) {
 const compareVals = (compareData || []).map(d => d?.value).filter(v => v != null && !Number.isNaN(v))
 const max = Math.max(
  1,
  ...data.map(d => d.value ?? 0),
  ...compareVals,
 )
 const barColor = {
  blue: BOBRICK_BAR,
  violet: BOBRICK_BAR,
  green: 'bg-[#34d399]/90 group-hover/bar:bg-[#34d399]',
  bobrick: BOBRICK_BAR,
 }[accent] ?? BOBRICK_BAR
 const hasCompare = Array.isArray(compareData) && compareData.length > 0

 return (
  <div className="space-y-2">
   {hasCompare && (
    <div className="flex flex-wrap gap-3 text-[11px] text-[#8b939e]">
     <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm bg-[#4dc4f4]" />
      {primaryLabel}
     </span>
     <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm bg-[#4a5560]" />
      {compareLabel}
     </span>
    </div>
   )}
   <div className="flex items-end gap-1.5 h-48 w-full">
    {data.map((d, i) => {
     const val = d.value ?? 0
     const cmp = compareData?.[i]?.value
     const pct = (val / max) * 100
     const cmpPct = cmp != null ? (cmp / max) * 100 : 0
     const isHi = i === highlightIndex
     return (
      <div key={i} className="group/bar relative flex-1 flex flex-col items-center justify-end h-full min-w-0">
       <div className="opacity-0 group-hover/bar:opacity-100 transition-opacity absolute -top-1
 -translate-y-full z-10 px-2 py-1 rounded-md text-xs whitespace-nowrap
               bg-[#18181d] text-[#eef2f7] border border-[#27272f] shadow-lg pointer-events-none">
        <div>{d.label}: <span className="font-semibold">{val != null ? formatValue(val) : '—'}</span></div>
        {cmp != null && (
         <div className="text-[#8b939e]">{compareLabel}: {formatValue(cmp)}</div>
        )}
       </div>
       <div className={`flex items-end justify-center gap-0.5 w-full h-full ${hasCompare ? '' : ''}`}>
        <div
         style={{ height: `${Math.max(pct, val > 0 ? 4 : 0)}%` }}
         className={`rounded-t-sm transition-all duration-500 ${hasCompare ? 'w-[45%]' : 'w-full'}
               ${isHi ? 'bg-[#fbbf24]' : barColor}
               ${val === 0 ? 'min-h-[2px] bg-[#27272f]' : ''}`}
        />
        {hasCompare && (
         <div
          style={{ height: `${Math.max(cmpPct, cmp > 0 ? 4 : 0)}%` }}
          className={`w-[45%] rounded-t-sm transition-all duration-500 bg-[#4a5560]
                ${!cmp ? 'min-h-[2px]' : ''}`}
         />
        )}
       </div>
       <span className="mt-1.5 text-[10px] leading-none text-[#8b939e] tabular-nums">
        {d.short ?? d.label}
       </span>
      </div>
     )
    })}
   </div>
  </div>
 )
}

/* ── Horizontal bar list ────────────────────────────────────────────────────── */
export function HorizontalBars({
 data,
 formatValue = v => v,
 accent = 'bobrick',
 emptyText = 'No data',
 /** When true, each bar width = value / (d.target || max) — use for dwell÷target */
 ratioMode = false,
}) {
 if (!data || data.length === 0) {
  return <p className="text-sm text-[#8b939e] py-8 text-center">{emptyText}</p>
 }
 const peerMax = Math.max(1, ...data.map(d => d.value ?? 0))
 const barColor = {
  blue: BOBRICK_GRAD,
  violet: BOBRICK_GRAD,
  green: 'from-[#34d399] to-[#10b981]',
  amber: 'from-[#fbbf24] to-[#f59e0b]',
  bobrick: BOBRICK_GRAD,
  danger: 'from-[#f87171] to-[#ef4444]',
 }[accent] ?? BOBRICK_GRAD

 return (
  <div className="space-y-3">
   {data.map((d, i) => {
    const val = d.value ?? 0
    let pct
    let overTarget = false
    if (ratioMode && d.target != null && d.target > 0) {
     const ratio = val / d.target
     pct = Math.min(ratio, 1) * 100
     overTarget = ratio > 1
    } else if (d.max != null && d.max > 0) {
     pct = (val / d.max) * 100
    } else {
     pct = (val / peerMax) * 100
    }
    const isSelected = !!d.highlight || !!d.is_selected
    const isMedian = !!d.is_median
    const fillClass = overTarget
     ? 'bg-gradient-to-r from-[#fbbf24] to-[#f59e0b]'
     : isSelected
      ? 'bg-gradient-to-r from-[#fbbf24] to-[#f59e0b]'
      : isMedian
       ? 'bg-[#4a5560]'
       : `bg-gradient-to-r ${barColor}`
    return (
     <div key={i} className="group">
      <div className="flex items-center justify-between mb-1 text-sm">
       <span className={`truncate pr-2 ${
        isSelected ? 'font-semibold text-[#fbbf24]'
         : isMedian ? 'font-medium text-[#8b939e] italic'
          : 'font-medium text-[#eef2f7]'
       }`}>
        {d.label}
       </span>
       <span className={`font-mono font-semibold tabular-nums shrink-0 ${
        overTarget ? 'text-[#fbbf24]' : isSelected ? 'text-[#fbbf24]' : 'text-[#4dc4f4]'
       }`}>
        {d.display ?? formatValue(d.value)}
       </span>
      </div>
      <div className="h-2.5 rounded-full bg-[#27272f] overflow-hidden">
       <div
        style={{ width: `${Math.max(pct, val > 0 ? 2 : 0)}%`, transitionDelay: `${i * 40}ms` }}
        className={`h-full rounded-full transition-all duration-700 ${fillClass}`}
       />
      </div>
      {ratioMode && d.target != null && d.target > 0 && (
       <p className="text-[10px] text-[#8b939e] mt-0.5 tabular-nums">
        {((val / d.target) * 100).toFixed(1)}% of target
       </p>
      )}
     </div>
    )
   })}
  </div>
 )
}

/* ── Area / line chart (SVG) — supports optional comparison series ───────────── */
export function AreaChart({
 data,
 compareData,
 formatValue = v => v,
 primaryLabel = 'Throughput',
 compareLabel = 'Compare',
}) {
 const W = 600
 const H = 180
 const PAD = { t: 12, r: 8, b: 8, l: 8 }
 const values = [
  ...data.map(d => d.value).filter(v => v != null && !Number.isNaN(v)),
  ...(compareData || []).map(d => d.value).filter(v => v != null && !Number.isNaN(v)),
 ]
 const max = Math.max(1, ...values, 0.01)
 const n = data.length
 const innerW = W - PAD.l - PAD.r
 const innerH = H - PAD.t - PAD.b
 const stepX = n > 1 ? innerW / (n - 1) : 0
 const y = v => PAD.t + innerH - ((v ?? 0) / max) * innerH
 const x = i => PAD.l + i * stepX

 const linePts = data.map((d, i) => `${x(i)},${y(d.value ?? 0)}`).join(' ')
 const areaPts = n
  ? `${PAD.l},${H - PAD.b} ${linePts} ${x(n - 1)},${H - PAD.b}`
  : ''

 const comparePts = compareData?.length
  ? compareData.map((d, i) => `${x(i)},${y(d.value ?? 0)}`).join(' ')
  : ''

 return (
  <div className="w-full">
   <div className="flex items-center gap-4 mb-1 text-[10px] text-[#8b939e]">
    <span className="inline-flex items-center gap-1.5">
     <span className="w-3 h-0.5 bg-[#4dc4f4] rounded" />
     {primaryLabel}
    </span>
    {compareData?.length > 0 && (
     <span className="inline-flex items-center gap-1.5">
      <span className="w-3 h-0.5 bg-[#8b939e] rounded" style={{ borderTop: '1px dashed #8b939e', height: 0 }} />
      {compareLabel}
     </span>
    )}
   </div>
   <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44 text-[#4dc4f4]" preserveAspectRatio="none">
    <defs>
     <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#4dc4f4" stopOpacity="0.28" />
      <stop offset="100%" stopColor="#4dc4f4" stopOpacity="0" />
     </linearGradient>
    </defs>
    {areaPts && <polygon points={areaPts} fill="url(#areaFill)" />}
    {comparePts && (
     <polyline
      points={comparePts}
      fill="none"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
      stroke="#8b939e"
      strokeDasharray="6 4"
     />
    )}
    {linePts && (
     <polyline
      points={linePts}
      fill="none"
      strokeWidth="2.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      stroke="#4dc4f4"
     />
    )}
    {data.map((d, i) => (
     <g key={i} className="group/pt">
      <circle cx={x(i)} cy={y(d.value ?? 0)} r="3.5" fill="#4dc4f4" />
      <circle cx={x(i)} cy={y(d.value ?? 0)} r="14" fill="transparent" />
      <title>
       {`${d.label}: ${formatValue(d.value)}`}
       {compareData?.[i]?.value != null ? ` · ${compareLabel}: ${formatValue(compareData[i].value)}` : ''}
      </title>
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

const SERIES_COLORS = ['#4dc4f4', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb7185', '#2dd4bf']

/* ── Multi-series line chart ────────────────────────────────────────────────── */
export function MultiLineChart({
 series,
 formatValue = v => v,
 emptyText = 'No data',
}) {
 /** series: [{ id, label, color?, points: [{ label, short?, value }] }] */
 if (!series?.length || !series.some(s => s.points?.length)) {
  return <p className="text-sm text-[#8b939e] py-8 text-center">{emptyText}</p>
 }
 const W = 640
 const H = 200
 const PAD = { t: 14, r: 10, b: 10, l: 10 }
 const allVals = series.flatMap(s => (s.points || []).map(p => p.value).filter(v => v != null && !Number.isNaN(v)))
 const max = Math.max(1, ...allVals, 0.01)
 const n = Math.max(...series.map(s => s.points?.length || 0), 1)
 const innerW = W - PAD.l - PAD.r
 const innerH = H - PAD.t - PAD.b
 const stepX = n > 1 ? innerW / (n - 1) : 0
 const y = v => PAD.t + innerH - ((v ?? 0) / max) * innerH
 const x = i => PAD.l + i * stepX
 const labels = series[0]?.points || []

 return (
  <div className="w-full">
   <div className="flex flex-wrap gap-3 mb-2 text-[10px] text-[#8b939e]">
    {series.map((s, i) => (
     <span key={s.id || i} className="inline-flex items-center gap-1.5">
      <span className="w-3 h-0.5 rounded" style={{ background: s.color || SERIES_COLORS[i % SERIES_COLORS.length] }} />
      {s.label}
     </span>
    ))}
   </div>
   <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48" preserveAspectRatio="none">
    {series.map((s, si) => {
     const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length]
     const pts = (s.points || []).map((p, i) => `${x(i)},${y(p.value ?? 0)}`).join(' ')
     const dashed = s.dashed
     return (
      <g key={s.id || si}>
       {pts && (
        <polyline
         points={pts}
         fill="none"
         stroke={color}
         strokeWidth={dashed ? 1.75 : 2.25}
         strokeLinejoin="round"
         strokeLinecap="round"
         strokeDasharray={dashed ? '5 4' : undefined}
         opacity={dashed ? 0.85 : 1}
        />
       )}
       {(s.points || []).map((p, i) => (
        p.value == null ? null : (
         <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill={color}>
          <title>{`${s.label} · ${p.label}: ${formatValue(p.value)}`}</title>
         </circle>
        )
       ))}
      </g>
     )
    })}
   </svg>
   <div className="flex justify-between mt-1 text-[10px] text-[#8b939e]">
    {labels.map((d, i) => (
     <span key={i} className={n > 10 && i % 2 !== 0 ? 'opacity-0' : ''}>{d.short ?? d.label}</span>
    ))}
   </div>
  </div>
 )
}

/* ── Grouped vertical bars (e.g. drawing × station) ─────────────────────────── */
export function GroupedBars({
 groups,
 keys,
 colors = SERIES_COLORS,
 formatValue = v => v,
 emptyText = 'No data',
 onSelect,
 showValues = true,
}) {
 /** groups: [{ label, short?, series?, drawing?, values }] */
 if (!groups?.length || !keys?.length) {
  return <p className="text-sm text-[#8b939e] py-8 text-center">{emptyText}</p>
 }
 const max = Math.max(
  1,
  ...groups.flatMap(g => keys.map(k => g.values?.[k] ?? 0)),
 )
 const ticks = [0, 0.25, 0.5, 0.75, 1].map(p => p * max)
 const labelH = '4.5rem'

 return (
  <div className="space-y-2">
   <div className="flex flex-wrap gap-3 text-[11px] text-[#8b939e]">
    {keys.map((k, i) => (
     <span key={k} className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[i % colors.length] }} />
      {k}
     </span>
    ))}
   </div>
   <div className="flex gap-2 w-full">
    <div
     className="flex flex-col justify-between w-11 shrink-0 pt-1"
     style={{ height: `calc(14rem + ${labelH})`, paddingBottom: labelH }}
    >
     {[...ticks].reverse().map((t, i) => (
      <span key={i} className="text-[10px] tabular-nums text-[#8b939e] text-right leading-none">
       {formatValue(t)}
      </span>
     ))}
    </div>
    <div className="relative flex-1 min-w-0" style={{ height: `calc(14rem + ${labelH})` }}>
     <div
      className="absolute inset-x-0 top-1 flex flex-col justify-between pointer-events-none"
      style={{ bottom: labelH }}
     >
      {ticks.map((_, i) => (
       <div key={i} className="border-t border-[#27272f]/80 w-full" />
      ))}
     </div>
     <div className="relative flex items-end gap-3 w-full h-full overflow-x-auto">
      {groups.map((g, gi) => {
       const seriesLine = g.series ? `Series ${g.series}` : null
       const drawingLine = g.drawing || g.short || g.label
       return (
        <button
         key={g.label || gi}
         type="button"
         onClick={() => onSelect?.(g)}
         title={g.label}
         className="group/bar relative flex flex-col items-center justify-end h-full min-w-[7.5rem] flex-1 basis-0"
        >
         <div className="opacity-0 group-hover/bar:opacity-100 transition-opacity absolute bottom-full mb-1
                         z-10 px-2 py-1.5 rounded-md text-xs max-w-[14rem]
                         bg-[#18181d] text-[#eef2f7] border border-[#27272f] shadow-lg pointer-events-none text-left">
          <div className="font-semibold mb-0.5 whitespace-normal break-words">{g.label}</div>
          {keys.map(k => (
           <div key={k} className="text-[#8b939e]">
            {k}: {g.values?.[k] != null ? formatValue(g.values[k]) : '—'}
           </div>
          ))}
         </div>
         <div className="flex items-end justify-center gap-1 w-full" style={{ height: '14rem' }}>
          {keys.map((k, i) => {
           const val = g.values?.[k] ?? 0
           const pct = (val / max) * 100
           return (
            <div key={k} className="flex flex-col items-center justify-end h-full" style={{ width: `${85 / keys.length}%` }}>
             {showValues && val > 0 && (
              <span className="text-[10px] font-semibold tabular-nums text-[#eef2f7] mb-0.5 leading-none">
               {formatValue(val)}
              </span>
             )}
             <div
              style={{
               height: `${Math.max(pct, val > 0 ? 4 : 0)}%`,
               background: colors[i % colors.length],
              }}
              className={`w-full rounded-t-sm transition-all duration-500
                    ${val === 0 ? 'min-h-[2px] !bg-[#27272f]' : ''}`}
             />
            </div>
           )
          })}
         </div>
         <div
          className="w-full px-0.5 text-center shrink-0 flex flex-col justify-start gap-0.5"
          style={{ height: labelH, paddingTop: '0.4rem' }}
         >
          {seriesLine && (
           <span className="text-[10px] font-semibold text-[#4dc4f4] leading-tight">
            {seriesLine}
           </span>
          )}
          <span className="text-[10px] font-medium text-[#eef2f7] leading-snug break-words hyphens-auto">
           {drawingLine}
          </span>
         </div>
        </button>
       )
      })}
     </div>
    </div>
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
