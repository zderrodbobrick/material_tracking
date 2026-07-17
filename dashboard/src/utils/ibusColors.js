/**
 * Stable accent colors per IBUS work order so map chips + sidebar cards match.
 * Tuned for Bobrick dark theme (black surfaces + vivid accents).
 */
const PALETTE = [
  {
    id: 'bobrick',
    hex: '#4dc4f4',
    hexSoft: '#6dd0f7',
    hexDeep: '#0099cc',
    card: 'border-[#4dc4f4]/30 from-[#4dc4f4]/10 to-[#18181d]',
    barTrack: 'bg-[#27272f]',
    barFill: 'bg-[#4dc4f4]',
    accentText: 'text-[#4dc4f4]',
    softText: 'text-[#4dc4f4]/80',
    ping: 'bg-[#4dc4f4]',
    badge: 'bg-[#0099cc]',
    popoverBorder: 'border-[#4dc4f4]/30',
    popoverHead: 'text-[#4dc4f4] bg-[#4dc4f4]/10 border-[#4dc4f4]/20',
    rowHover: 'hover:bg-[#4dc4f4]/10',
  },
  {
    id: 'emerald',
    hex: '#34d399',
    hexSoft: '#6ee7b7',
    hexDeep: '#059669',
    card: 'border-[#34d399]/30 from-[#34d399]/10 to-[#18181d]',
    barTrack: 'bg-[#27272f]',
    barFill: 'bg-[#34d399]',
    accentText: 'text-[#34d399]',
    softText: 'text-[#34d399]/80',
    ping: 'bg-[#34d399]',
    badge: 'bg-[#059669]',
    popoverBorder: 'border-[#34d399]/30',
    popoverHead: 'text-[#34d399] bg-[#34d399]/10 border-[#34d399]/20',
    rowHover: 'hover:bg-[#34d399]/10',
  },
  {
    id: 'amber',
    hex: '#fbbf24',
    hexSoft: '#fcd34d',
    hexDeep: '#d97706',
    card: 'border-[#fbbf24]/30 from-[#fbbf24]/10 to-[#18181d]',
    barTrack: 'bg-[#27272f]',
    barFill: 'bg-[#fbbf24]',
    accentText: 'text-[#fbbf24]',
    softText: 'text-[#fbbf24]/80',
    ping: 'bg-[#fbbf24]',
    badge: 'bg-[#d97706]',
    popoverBorder: 'border-[#fbbf24]/30',
    popoverHead: 'text-[#fbbf24] bg-[#fbbf24]/10 border-[#fbbf24]/20',
    rowHover: 'hover:bg-[#fbbf24]/10',
  },
  {
    id: 'violet',
    hex: '#a78bfa',
    hexSoft: '#c4b5fd',
    hexDeep: '#7c3aed',
    card: 'border-[#a78bfa]/30 from-[#a78bfa]/10 to-[#18181d]',
    barTrack: 'bg-[#27272f]',
    barFill: 'bg-[#a78bfa]',
    accentText: 'text-[#a78bfa]',
    softText: 'text-[#a78bfa]/80',
    ping: 'bg-[#a78bfa]',
    badge: 'bg-[#7c3aed]',
    popoverBorder: 'border-[#a78bfa]/30',
    popoverHead: 'text-[#a78bfa] bg-[#a78bfa]/10 border-[#a78bfa]/20',
    rowHover: 'hover:bg-[#a78bfa]/10',
  },
  {
    id: 'rose',
    hex: '#fb7185',
    hexSoft: '#fda4af',
    hexDeep: '#e11d48',
    card: 'border-[#fb7185]/30 from-[#fb7185]/10 to-[#18181d]',
    barTrack: 'bg-[#27272f]',
    barFill: 'bg-[#fb7185]',
    accentText: 'text-[#fb7185]',
    softText: 'text-[#fb7185]/80',
    ping: 'bg-[#fb7185]',
    badge: 'bg-[#e11d48]',
    popoverBorder: 'border-[#fb7185]/30',
    popoverHead: 'text-[#fb7185] bg-[#fb7185]/10 border-[#fb7185]/20',
    rowHover: 'hover:bg-[#fb7185]/10',
  },
]

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
