import { Package } from 'lucide-react'
import { ibusOrderKey } from '../utils/ibusOrder'
import { formatDwell } from './DwellTimer'
import { PRODUCTION_LINE_ORDER } from '../utils/machineRegions'

function ibusLabel(j) {
  return j.ibus_order ?? j.ibus_number ?? ibusOrderKey(j) ?? j.key ?? '—'
}

function shortStation(name) {
  if (!name) return '—'
  const hit = PRODUCTION_LINE_ORDER.find(s => s === name)
  if (hit) {
    // Prefer chip-ish short names from regions via name itself
    return name.replace(/^Insert Station$/, 'Insert')
      .replace(/^Evolve Edge Finisher$/, 'Evolve Edge')
      .replace(/^Evolve Drilling$/, 'Evolve Drill')
      .replace(/^LB Installation$/, 'LB Install')
      .replace(/^Outswing Latch Drilling$/, 'LB Install')
      .replace(/^1\/2 Edgefinisher$/, 'Edgefinisher')
      .replace(/^Holzma\.Falloff$/, 'Falloff')
  }
  return name
}

function progressPct(j) {
  if (typeof j.progress === 'number') return Math.round(Math.min(1, Math.max(0, j.progress)) * 100)
  const idx = PRODUCTION_LINE_ORDER.indexOf(j.current_station)
  if (idx < 0) return 8
  return Math.round(((idx + 0.55) / PRODUCTION_LINE_ORDER.length) * 100)
}

/**
 * Full-width bottom strip: open IBUS cards with a top progress bar.
 */
export function IbusOrdersSidebar({ journeys = [] }) {
  return (
    <aside className="flex flex-col min-h-0 min-w-0 w-full">
      <div
        className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden
                   dark:border-slate-700/60 dark:bg-slate-800/60 flex flex-col flex-1 min-h-0"
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700/60 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100">
            <Package className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            In Progress IBUS
            <span className="ml-auto tabular-nums text-xs font-medium text-gray-400 dark:text-slate-500">
              {journeys.length}
            </span>
          </h2>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            Open orders — completed ones move to the Completed IBUS tab
          </p>
        </div>

        {journeys.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-gray-400 dark:text-slate-500">
            No open IBUS orders
          </p>
        ) : (
          <div className="p-3.5 overflow-y-auto flex-1 min-h-0 max-h-[22rem]">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {journeys.map(j => {
                const label = ibusLabel(j)
                const pct = progressPct(j)
                return (
                  <div
                    key={j.key ?? label}
                    className="relative aspect-square min-h-[8.5rem] rounded-xl border border-amber-200/80
                               bg-gradient-to-b from-amber-50/80 to-white
                               dark:from-amber-500/10 dark:to-slate-900/40 dark:border-amber-500/25
                               overflow-hidden flex flex-col shadow-sm"
                    title={`${label} · ${pct}% · ${j.current_station ?? ''}`}
                  >
                    {/* Top progress bar */}
                    <div className="h-2.5 w-full bg-amber-100 dark:bg-slate-700/80 shrink-0">
                      <div
                        className="h-full bg-amber-500 dark:bg-amber-400 transition-[width] duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex-1 flex flex-col justify-between p-3 min-h-0">
                      <p className="font-mono text-xs sm:text-sm font-bold text-gray-900 dark:text-slate-100
                                    leading-snug break-all">
                        {label}
                      </p>
                      {j.part_count > 1 && (
                        <p className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
                          {j.part_count} parts
                        </p>
                      )}
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                          {shortStation(j.current_station)}
                        </p>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                            {pct}%
                          </span>
                          <span className="text-xs font-mono text-gray-400 dark:text-slate-500">
                            {j.total_production_display
                              ?? formatDwell(j.total_production_seconds)
                              ?? '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
