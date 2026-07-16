/**
 * Stable accent colors per IBUS work order so map chips + sidebar cards match.
 * Index 0 stays amber (existing look); later orders get distinct hues.
 */
const PALETTE = [
  {
    id: 'amber',
    hex: '#f59e0b',
    hexSoft: '#fbbf24',
    hexDeep: '#b45309',
    card: 'border-amber-200/80 from-amber-50/80 dark:from-amber-500/10 dark:border-amber-500/25',
    barTrack: 'bg-amber-100 dark:bg-slate-700/80',
    barFill: 'bg-amber-500 dark:bg-amber-400',
    accentText: 'text-amber-700 dark:text-amber-300',
    softText: 'text-amber-700/80 dark:text-amber-300/80',
    ping: 'bg-amber-400',
    badge: 'bg-amber-700',
    popoverBorder: 'border-amber-200 dark:border-amber-500/30',
    popoverHead: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20',
    rowHover: 'hover:bg-amber-50 dark:hover:bg-amber-500/10',
  },
  {
    id: 'sky',
    hex: '#0ea5e9',
    hexSoft: '#38bdf8',
    hexDeep: '#0369a1',
    card: 'border-sky-200/80 from-sky-50/80 dark:from-sky-500/10 dark:border-sky-500/25',
    barTrack: 'bg-sky-100 dark:bg-slate-700/80',
    barFill: 'bg-sky-500 dark:bg-sky-400',
    accentText: 'text-sky-700 dark:text-sky-300',
    softText: 'text-sky-700/80 dark:text-sky-300/80',
    ping: 'bg-sky-400',
    badge: 'bg-sky-700',
    popoverBorder: 'border-sky-200 dark:border-sky-500/30',
    popoverHead: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/10 border-sky-100 dark:border-sky-500/20',
    rowHover: 'hover:bg-sky-50 dark:hover:bg-sky-500/10',
  },
  {
    id: 'violet',
    hex: '#8b5cf6',
    hexSoft: '#a78bfa',
    hexDeep: '#6d28d9',
    card: 'border-violet-200/80 from-violet-50/80 dark:from-violet-500/10 dark:border-violet-500/25',
    barTrack: 'bg-violet-100 dark:bg-slate-700/80',
    barFill: 'bg-violet-500 dark:bg-violet-400',
    accentText: 'text-violet-700 dark:text-violet-300',
    softText: 'text-violet-700/80 dark:text-violet-300/80',
    ping: 'bg-violet-400',
    badge: 'bg-violet-700',
    popoverBorder: 'border-violet-200 dark:border-violet-500/30',
    popoverHead: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/10 border-violet-100 dark:border-violet-500/20',
    rowHover: 'hover:bg-violet-50 dark:hover:bg-violet-500/10',
  },
  {
    id: 'rose',
    hex: '#f43f5e',
    hexSoft: '#fb7185',
    hexDeep: '#be123c',
    card: 'border-rose-200/80 from-rose-50/80 dark:from-rose-500/10 dark:border-rose-500/25',
    barTrack: 'bg-rose-100 dark:bg-slate-700/80',
    barFill: 'bg-rose-500 dark:bg-rose-400',
    accentText: 'text-rose-700 dark:text-rose-300',
    softText: 'text-rose-700/80 dark:text-rose-300/80',
    ping: 'bg-rose-400',
    badge: 'bg-rose-700',
    popoverBorder: 'border-rose-200 dark:border-rose-500/30',
    popoverHead: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20',
    rowHover: 'hover:bg-rose-50 dark:hover:bg-rose-500/10',
  },
  {
    id: 'lime',
    hex: '#84cc16',
    hexSoft: '#a3e635',
    hexDeep: '#4d7c0f',
    card: 'border-lime-200/80 from-lime-50/80 dark:from-lime-500/10 dark:border-lime-500/25',
    barTrack: 'bg-lime-100 dark:bg-slate-700/80',
    barFill: 'bg-lime-500 dark:bg-lime-400',
    accentText: 'text-lime-700 dark:text-lime-300',
    softText: 'text-lime-700/80 dark:text-lime-300/80',
    ping: 'bg-lime-400',
    badge: 'bg-lime-700',
    popoverBorder: 'border-lime-200 dark:border-lime-500/30',
    popoverHead: 'text-lime-700 dark:text-lime-300 bg-lime-50 dark:bg-lime-500/10 border-lime-100 dark:border-lime-500/20',
    rowHover: 'hover:bg-lime-50 dark:hover:bg-lime-500/10',
  },
]

/**
 * Stable color from IBUS key only (not list order), so sidebar cards and
 * map chips always match for the same work order.
 */
export function ibusColorIndex(key, _knownKeys = []) {
  if (!key) return 0
  let h = 2166136261
  const s = String(key).toUpperCase()
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % PALETTE.length
}

export function ibusAccent(key, knownKeys = []) {
  return PALETTE[ibusColorIndex(key, knownKeys)]
}

export { PALETTE as IBUS_COLOR_PALETTE }
