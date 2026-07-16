import { useMemo, useState } from 'react'
import { ArrowLeft, Package } from 'lucide-react'
import { ibusOrderKey, partTagLabel } from '../utils/ibusOrder'
import { ibusAccent } from '../utils/ibusColors'
import { DwellTimer, formatDwell } from './DwellTimer'
import { PRODUCTION_LINE_ORDER } from '../utils/machineRegions'

function ibusLabel(j) {
  return j.ibus_order ?? j.ibus_number ?? ibusOrderKey(j) ?? j.key ?? '—'
}

function shortStation(name) {
  if (!name) return '—'
  if (name === 'Tenoner' || name === 'Tennoner') return 'Tennoner'
  const hit = PRODUCTION_LINE_ORDER.find(s => s === name)
  if (hit) {
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
  if (typeof j.progress === 'number') {
    return Math.round(Math.min(1, Math.max(0, j.progress)) * 100)
  }
  const spine = ['Tenoner', 'Gannomat', 'Insert Station', 'Evolve Edge Finisher',
    'Evolve Drilling', 'Inspect', 'Anderson', 'Pack out']
  const raw = j.current_station === 'Tennoner' ? 'Tenoner' : j.current_station
  const idx = spine.indexOf(raw)
  if (idx < 0) return 0
  return Math.round((idx / Math.max(spine.length - 1, 1)) * 100)
}

function partCurrentStation(p) {
  if (p?.current_station) return p.current_station
  const machines = p?.machines ?? []
  const open = [...machines].reverse().find(m => m.status === 'open' || m.status === 'Open')
  if (open?.station_name) return open.station_name
  return machines.at(-1)?.station_name || '—'
}

function partOpenMachine(p) {
  const machines = p?.machines ?? []
  return [...machines].reverse().find(m => m.status === 'open' || m.status === 'Open') || null
}

/**
 * Open IBUS cards with a top progress bar (side panel next to the map).
 * Click a card to see every part and where it is right now.
 */
export function IbusOrdersSidebar({ journeys = [] }) {
  const [selectedKey, setSelectedKey] = useState(null)

  const knownKeys = useMemo(
    () => journeys.map(j => j.key ?? ibusLabel(j)).filter(Boolean),
    [journeys],
  )

  const selected = useMemo(
    () => journeys.find(j => (j.key ?? ibusLabel(j)) === selectedKey) ?? null,
    [journeys, selectedKey],
  )

  return (
    <aside className="flex flex-col min-h-0 min-w-0 w-full h-full">
      <div
        className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden
                   dark:border-slate-700/60 dark:bg-slate-800/60 flex flex-col flex-1 min-h-0 h-full"
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700/60 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100">
            {selected ? (
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800
                           dark:text-slate-400 dark:hover:text-slate-100"
                title="Back to orders"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <Package className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            )}
            {selected ? ibusLabel(selected) : 'In Progress IBUS'}
            <span className="ml-auto tabular-nums text-xs font-medium text-gray-400 dark:text-slate-500">
              {selected ? `${selected.parts?.length ?? selected.part_count ?? 0} parts` : journeys.length}
            </span>
          </h2>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            {selected
              ? `${shortStation(selected.current_station)} · live dwell while at a station`
              : 'Open orders — click a card to see parts & locations'}
          </p>
        </div>

        {selected ? (
          <OrderPartsDetail order={selected} accent={ibusAccent(selected.key ?? ibusLabel(selected), knownKeys)} />
        ) : journeys.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-gray-400 dark:text-slate-500">
            No open IBUS orders
          </p>
        ) : (
          <div className="p-3.5 overflow-y-auto flex-1 min-h-0">
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
              {journeys.map(j => {
                const label = ibusLabel(j)
                const key = j.key ?? label
                const pct = progressPct(j)
                const accent = ibusAccent(key, knownKeys)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={`relative aspect-square min-h-[8.5rem] rounded-xl border bg-gradient-to-b to-white
                               dark:to-slate-900/40 overflow-hidden flex flex-col shadow-sm text-left
                               hover:brightness-[1.03] focus:outline-none focus-visible:ring-2
                               focus-visible:ring-offset-1 focus-visible:ring-amber-400 cursor-pointer
                               ${accent.card}`}
                    title={`${label} · ${pct}% · ${j.current_station ?? ''} — click for parts`}
                  >
                    <div className={`h-2.5 w-full shrink-0 ${accent.barTrack}`}>
                      <div
                        className={`h-full transition-[width] duration-500 ${accent.barFill}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex-1 flex flex-col justify-between p-3 min-h-0">
                      <p className="font-mono text-xs sm:text-sm font-bold text-gray-900 dark:text-slate-100
                                    leading-snug break-all">
                        {label}
                      </p>
                      {(j.part_count > 1 || (j.parts?.length ?? 0) > 1) && (
                        <p className={`text-[10px] ${accent.softText}`}>
                          {j.part_count ?? j.parts?.length} parts
                        </p>
                      )}
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                          {shortStation(j.current_station)}
                        </p>
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-xs font-semibold tabular-nums ${accent.accentText}`}>
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
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function OrderPartsDetail({ order, accent }) {
  const parts = order.parts ?? []

  return (
    <div className="overflow-y-auto flex-1 min-h-0">
      {parts.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-gray-400 dark:text-slate-500">
          No parts tracked for this order yet
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700/50">
          {parts.map(p => {
            const tag = p.part_tag || partTagLabel(p) || p.epc || '—'
            const station = partCurrentStation(p)
            const openM = partOpenMachine(p)
            return (
              <li
                key={p.epc || tag}
                className={`px-3.5 py-2.5 ${accent.rowHover}`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 w-2 h-2 rounded-full shrink-0 ring-1 ring-white/80"
                    style={{ backgroundColor: accent.hex }}
                    title={ibusLabel(order)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] font-semibold text-gray-900 dark:text-slate-100 break-all">
                      {tag}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 truncate">
                      {[p.part_number, p.part_name].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[11px] font-medium ${accent.accentText}`}>
                      {shortStation(station)}
                    </p>
                    <p className="text-[10px] font-mono text-gray-500 dark:text-slate-400 mt-0.5">
                      {openM ? (
                        <DwellTimer
                          entranceTime={openM.entry_time}
                          exitTime={null}
                          dwellSeconds={null}
                        />
                      ) : (
                        p.total_production_display
                          ?? formatDwell(p.total_production_seconds)
                          ?? '—'
                      )}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
