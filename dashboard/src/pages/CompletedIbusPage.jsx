import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle, Search, Clock, Users, Package, Factory } from 'lucide-react'
import { apiFetch } from '../api'
import { Panel } from '../components/Panel'
import { formatDwell } from '../components/DwellTimer'
import { ibusOrderKey, partTagLabel } from '../utils/ibusOrder'

function ibusLabel(j) {
  return j.ibus_order ?? j.ibus_number ?? ibusOrderKey(j) ?? j.key ?? '—'
}

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

function partFields(j) {
  const parts = j.parts ?? []
  return {
    ibus: ibusLabel(j),
    qty: parts.length || j.part_count || '—',
    partNumber: parts.map(p => p.part_number || p.part_tag).filter(Boolean).join(', ') || j.part_number || '—',
    partName: parts.map(p => p.part_name).filter(Boolean).join(', ') || j.part_name || '—',
    partType: j.part_type ?? 'IBUS',
    workOrder: j.work_order ?? (ibusLabel(j).startsWith('IBUS') ? ibusLabel(j).slice(4) : '—'),
    parts,
  }
}

/**
 * Dedicated tab: every completed IBUS with production time, operators,
 * part info, and per-machine dwell.
 */
export function CompletedIbusPage({ tick = 0 }) {
  const [journeys, setJourneys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch('/api/ibus?status=completed&limit=120')
      setJourneys(Array.isArray(rows) ? rows : [])
      setError(null)
    } catch (e) {
      setError(e?.message || 'Failed to load completed IBUS')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, tick])

  const filtered = useMemo(() => {
    if (!search.trim()) return journeys
    const q = search.trim().toLowerCase()
    return journeys.filter(j => {
      const p = partFields(j)
      return `${p.ibus} ${p.partNumber} ${p.workOrder} ${p.parts.map(x => x.part_tag).join(' ')}`.toLowerCase().includes(q)
    })
  }, [journeys, search])

  const selected = useMemo(() => {
    if (!filtered.length) return null
    const hit = filtered.find(j => j.key === selectedKey)
    return hit ?? filtered[0]
  }, [filtered, selectedKey])

  useEffect(() => {
    if (selected && selected.key !== selectedKey) setSelectedKey(selected.key)
  }, [selected, selectedKey])

  const detail = selected ? partFields(selected) : null

  return (
    <div className="space-y-4">
      <Panel
        title="Completed IBUS"
        subtitle="Finished orders — production time, operators, part info, and machine dwell"
        icon={CheckCircle}
        iconColor="text-emerald-500 dark:text-emerald-400"
        right={
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search IBUS / part / WO…"
              className="pl-8 pr-3 py-1.5 text-sm rounded-md w-52 border border-gray-300 bg-white
                         text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500
                         dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
            />
          </div>
        }
      >
        {error && (
          <p className="px-5 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {loading && !journeys.length ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
            {journeys.length === 0 ? 'No completed IBUS orders yet' : 'No matches'}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] gap-0 border-t border-gray-200 dark:border-slate-700/60">
            {/* List */}
            <ul className="max-h-[min(70vh,720px)] overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700/50
                           border-r border-gray-200 dark:border-slate-700/60">
              {filtered.map(j => {
                const label = ibusLabel(j)
                const active = selected?.key === j.key
                return (
                  <li key={j.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(j.key)}
                      className={`w-full text-left px-4 py-3 transition-colors
                        ${active
                          ? 'bg-emerald-50 dark:bg-emerald-500/10'
                          : 'hover:bg-gray-50 dark:hover:bg-slate-900/40'}`}
                    >
                      <p className="font-mono text-xs font-bold text-gray-900 dark:text-slate-100 truncate">
                        {label}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-slate-400">
                        <span className="truncate">
                          {j.part_count > 1 ? `${j.part_count} parts` : (j.parts?.[0]?.part_tag ?? j.part_number ?? '—')}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums">
                          {j.total_production_display ?? formatDwell(j.total_production_seconds) ?? '—'}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* Detail */}
            {selected && detail && (
              <div className="p-4 sm:p-5 space-y-4 max-h-[min(70vh,720px)] overflow-y-auto">
                <div>
                  <p className="font-mono text-lg font-bold text-gray-900 dark:text-slate-100">
                    {detail.ibus}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    {formatWhen(selected.entry_time)} → {formatWhen(selected.exit_time)}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-gray-200 dark:border-slate-700/60 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      <Clock className="w-3 h-3" /> Total production
                    </p>
                    <p className="mt-1 font-mono text-base font-semibold text-gray-900 dark:text-slate-100">
                      {selected.total_production_display
                        ?? formatDwell(selected.total_production_seconds)
                        ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-slate-700/60 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      <Factory className="w-3 h-3" /> Machines
                    </p>
                    <p className="mt-1 text-base font-semibold text-gray-900 dark:text-slate-100">
                      {selected.stations_done ?? selected.machines?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-slate-700/60 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      <Users className="w-3 h-3" /> Operators
                    </p>
                    <p className="mt-1 text-base font-semibold text-gray-900 dark:text-slate-100">
                      {selected.operators?.length ?? 0}
                    </p>
                  </div>
                </div>

                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider
                                 text-gray-500 dark:text-slate-400 mb-2">
                    <Package className="w-3.5 h-3.5" /> Part information
                  </h3>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                    {[
                      ['Parts in order', detail.partNumber],
                      ['Part tags', detail.parts.map(p => p.part_tag || partTagLabel(p)).join(' · ') || '—'],
                      ['Part name', detail.partName],
                      ['Type', detail.partType],
                      ['WO #', detail.workOrder],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">{k}</dt>
                        <dd className="font-mono text-gray-800 dark:text-slate-200 break-all">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider
                                 text-gray-500 dark:text-slate-400 mb-2">
                    <Users className="w-3.5 h-3.5" /> Operators who worked on it
                  </h3>
                  {!selected.operators?.length ? (
                    <p className="text-sm text-gray-400 dark:text-slate-500">No operators recorded</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selected.operators.map(op => (
                        <li
                          key={op.operator_id ?? op.operator_name}
                          className="flex flex-wrap items-baseline justify-between gap-2 rounded-md
                                     px-3 py-2 bg-gray-50 dark:bg-slate-900/40 text-sm"
                        >
                          <span className="font-medium text-gray-900 dark:text-slate-100">
                            {op.operator_name ?? '—'}
                          </span>
                          <span className="text-[11px] text-gray-500 dark:text-slate-400">
                            {(op.stations || []).join(' · ') || '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider
                                 text-gray-500 dark:text-slate-400 mb-2">
                    <Factory className="w-3.5 h-3.5" /> Machine dwell
                  </h3>
                  {!selected.machines?.length ? (
                    <p className="text-sm text-gray-400 dark:text-slate-500">No machine sessions</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700/60">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left bg-gray-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wider
                                         text-gray-500 dark:text-slate-400">
                            <th className="px-3 py-2 font-semibold">Part</th>
                            <th className="px-3 py-2 font-semibold">Machine</th>
                            <th className="px-3 py-2 font-semibold">Dwell</th>
                            <th className="px-3 py-2 font-semibold">Entered</th>
                            <th className="px-3 py-2 font-semibold">Exit</th>
                            <th className="px-3 py-2 font-semibold">Operators</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                          {selected.machines.map(m => (
                            <tr key={m.session_id ?? `${m.station_name}-${m.entry_time}`}>
                              <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">
                                {m.part_tag ?? m.part_number ?? '—'}
                              </td>
                              <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap">
                                {m.station_name}
                              </td>
                              <td className="px-3 py-2 font-mono tabular-nums text-gray-700 dark:text-slate-300">
                                {m.dwell_time_display ?? formatDwell(m.dwell_seconds) ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                                {formatWhen(m.entry_time)}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                                {formatWhen(m.exit_time)}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300">
                                {(m.operators || []).map(o => o.operator_name).filter(Boolean).join(', ') || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
