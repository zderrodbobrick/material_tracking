import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle, Search, Clock, Users, Package, Factory } from 'lucide-react'
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
      second: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

function woNumber(j) {
  const label = ibusLabel(j)
  if (j.work_order) return String(j.work_order)
  if (label.startsWith('IBUS')) return label.slice(4)
  return label
}

/**
 * Completed IBUS: work-order squares → parts table → per-machine TIME | PART | RTLS.
 */
export function CompletedIbusPage({ tick = 0 }) {
  const [journeys, setJourneys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const [selectedPartEpc, setSelectedPartEpc] = useState(null)

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
      const label = ibusLabel(j)
      const wo = woNumber(j)
      const parts = (j.parts ?? []).map(p => `${p.part_tag} ${p.part_number} ${p.epc}`).join(' ')
      return `${label} ${wo} ${parts}`.toLowerCase().includes(q)
    })
  }, [journeys, search])

  const selectedOrder = useMemo(
    () => filtered.find(j => j.key === selectedKey) ?? null,
    [filtered, selectedKey],
  )

  const selectedPart = useMemo(() => {
    if (!selectedOrder || selectedPartEpc == null) return null
    return (selectedOrder.parts ?? []).find(p => (p.epc || p.part_tag) === selectedPartEpc) ?? null
  }, [selectedOrder, selectedPartEpc])

  const openOrder = (key) => {
    setSelectedKey(key)
    setSelectedPartEpc(null)
  }

  const backToOrders = () => {
    setSelectedKey(null)
    setSelectedPartEpc(null)
  }

  const backToParts = () => {
    setSelectedPartEpc(null)
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Completed IBUS"
        subtitle={
          selectedPart
            ? `${selectedPart.part_tag || selectedPart.part_number} — machines`
            : selectedOrder
              ? `${ibusLabel(selectedOrder)} — parts`
              : 'Select a work order'
        }
        icon={CheckCircle}
        iconColor="text-emerald-500 dark:text-emerald-400"
        right={
          <div className="flex items-center gap-2">
            {(selectedOrder || selectedPart) && (
              <button
                type="button"
                onClick={selectedPart ? backToParts : backToOrders}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
                           border border-gray-200 text-gray-600 hover:bg-gray-50
                           dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {selectedPart ? 'Parts' : 'Orders'}
              </button>
            )}
            {!selectedOrder && (
              <div className="relative">
                <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search WO / IBUS…"
                  className="pl-8 pr-3 py-1.5 text-sm rounded-md w-52 border border-gray-300 bg-white
                             text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500
                             dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
                />
              </div>
            )}
          </div>
        }
      >
        {error && (
          <p className="px-5 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {loading && !journeys.length ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">Loading…</p>
        ) : selectedPart ? (
          <PartMachineView part={selectedPart} orderLabel={ibusLabel(selectedOrder)} />
        ) : selectedOrder ? (
          <OrderPartsView
            order={selectedOrder}
            onSelectPart={(epc) => setSelectedPartEpc(epc)}
          />
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
            {journeys.length === 0 ? 'No completed IBUS orders yet' : 'No matches'}
          </p>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {filtered.map(j => {
                const label = ibusLabel(j)
                const wo = woNumber(j)
                return (
                  <button
                    key={j.key}
                    type="button"
                    onClick={() => openOrder(j.key)}
                    className="aspect-square min-h-[8.5rem] rounded-xl border border-emerald-200/80
                               bg-gradient-to-b from-emerald-50/80 to-white
                               dark:from-emerald-500/10 dark:to-slate-900/40 dark:border-emerald-500/25
                               overflow-hidden flex flex-col shadow-sm text-left
                               hover:border-emerald-400 dark:hover:border-emerald-400/50
                               transition-colors p-3"
                    title={label}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700/80 dark:text-emerald-300/80">
                      Work order
                    </p>
                    <p className="mt-1 font-mono text-base sm:text-lg font-bold text-gray-900 dark:text-slate-100 leading-snug break-all">
                      {wo}
                    </p>
                    <p className="mt-auto text-[11px] font-mono text-gray-500 dark:text-slate-400 truncate">
                      {label}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                      <span>{j.part_count ?? j.parts?.length ?? 0} part{(j.part_count ?? 0) === 1 ? '' : 's'}</span>
                      <span className="font-mono tabular-nums">
                        {j.total_production_display ?? formatDwell(j.total_production_seconds) ?? '—'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}

function OrderPartsView({ order, onSelectPart }) {
  const parts = order.parts ?? []

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xl font-bold text-gray-900 dark:text-slate-100">
            {ibusLabel(order)}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            WO {woNumber(order)} · {formatWhen(order.entry_time)} → {formatWhen(order.exit_time)}
          </p>
        </div>
        <p className="text-sm font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
          {order.total_production_display ?? formatDwell(order.total_production_seconds) ?? '—'} total
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left bg-gray-50 dark:bg-slate-900/50 text-[11px] uppercase tracking-wider
                           text-gray-500 dark:text-slate-400">
              <th className="px-3 py-2.5 font-semibold">Part info (full IBUS #)</th>
              <th className="px-3 py-2.5 font-semibold">Total production</th>
              <th className="px-3 py-2.5 font-semibold">Start</th>
              <th className="px-3 py-2.5 font-semibold">End</th>
              <th className="px-3 py-2.5 font-semibold">Operators</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {parts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-400 dark:text-slate-500">
                  No parts in this order
                </td>
              </tr>
            ) : (
              parts.map(p => {
                const key = p.epc || p.part_tag
                const ops = (p.operators ?? []).map(o => o.operator_name).filter(Boolean)
                return (
                  <tr
                    key={key}
                    className="cursor-pointer hover:bg-emerald-50/70 dark:hover:bg-emerald-500/10 transition-colors"
                    onClick={() => onSelectPart(key)}
                  >
                    <td className="px-3 py-3">
                      <p className="font-mono text-xs font-semibold text-gray-900 dark:text-slate-100 break-all">
                        {p.part_tag || partTagLabel(p) || p.ibus_number || '—'}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                        {[p.part_number, p.part_name].filter(Boolean).join(' · ') || 'Click for machines'}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums text-gray-800 dark:text-slate-200 whitespace-nowrap">
                      {p.total_production_display ?? formatDwell(p.total_production_seconds) ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">
                      {formatWhen(p.entry_time)}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">
                      {formatWhen(p.exit_time)}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-700 dark:text-slate-300">
                      {ops.length ? ops.join(', ') : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 dark:text-slate-500">
        Click a part row to see every machine visit
      </p>
    </div>
  )
}

function PartMachineView({ part, orderLabel }) {
  const machines = part.machines ?? []

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div>
        <p className="font-mono text-lg font-bold text-gray-900 dark:text-slate-100 break-all">
          {part.part_tag || part.ibus_number || '—'}
        </p>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
          {orderLabel} · {part.part_number || '—'}
          {part.part_name ? ` · ${part.part_name}` : ''}
        </p>
      </div>

      {machines.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400 dark:text-slate-500">
          No machine sessions for this part
        </p>
      ) : (
        <div className="space-y-3">
          {machines.map(m => (
            <MachineVisitCard key={m.session_id ?? `${m.station_name}-${m.entry_time}`} machine={m} />
          ))}
        </div>
      )}
    </div>
  )
}

function MachineVisitCard({ machine }) {
  const part = machine.part ?? machine
  const rtls = machine.rtls ?? machine.operators ?? []

  return (
    <article className="rounded-xl border border-gray-200 dark:border-slate-700/60 overflow-hidden
                        bg-white dark:bg-slate-900/30 shadow-sm">
      <header className="px-4 py-2.5 border-b border-gray-200 dark:border-slate-700/60
                         flex flex-wrap items-center justify-between gap-2
                         bg-gray-50 dark:bg-slate-900/50">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100">
          <Factory className="w-4 h-4 text-sky-500" />
          {machine.station_name || '—'}
        </h3>
        <span className="font-mono text-xs tabular-nums text-gray-500 dark:text-slate-400">
          {machine.dwell_time_display ?? formatDwell(machine.dwell_seconds) ?? '—'}
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x
                      divide-gray-200 dark:divide-slate-700/60">
        {/* TIME INFO */}
        <section className="p-4 min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider
                        text-gray-500 dark:text-slate-400 mb-3">
            <Clock className="w-3.5 h-3.5" /> Time info
          </p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">Entered</dt>
              <dd className="font-mono text-gray-900 dark:text-slate-100">{formatWhen(machine.entry_time)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">Exited</dt>
              <dd className="font-mono text-gray-900 dark:text-slate-100">{formatWhen(machine.exit_time)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">Dwell</dt>
              <dd className="font-mono text-gray-900 dark:text-slate-100">
                {machine.dwell_time_display ?? formatDwell(machine.dwell_seconds) ?? '—'}
              </dd>
            </div>
          </dl>
        </section>

        {/* PART INFO */}
        <section className="p-4 min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider
                        text-gray-500 dark:text-slate-400 mb-3">
            <Package className="w-3.5 h-3.5" /> Part info
          </p>
          <dl className="space-y-2 text-sm">
            {[
              ['Full IBUS #', part.part_tag || part.ibus_number || '—'],
              ['Part number', part.part_number || '—'],
              ['Part name', part.part_name || '—'],
              ['Type', part.part_type || '—'],
              ['Work order', part.work_order || '—'],
              ['EPC', part.epc || '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">{k}</dt>
                <dd className="font-mono text-gray-900 dark:text-slate-100 break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* RTLS INFO */}
        <section className="p-4 min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider
                        text-gray-500 dark:text-slate-400 mb-3">
            <Users className="w-3.5 h-3.5" /> RTLS info
          </p>
          {rtls.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">
              No operators recorded at this machine while the part was here
            </p>
          ) : (
            <ul className="space-y-2.5">
              {rtls.map((op, i) => (
                <li
                  key={`${op.operator_id ?? op.operator_name}-${op.entered_at ?? i}`}
                  className="rounded-lg bg-gray-50 dark:bg-slate-900/50 px-3 py-2 text-sm"
                >
                  <p className="font-medium text-gray-900 dark:text-slate-100">
                    {op.operator_name || '—'}
                    {op.confirmed === false && (
                      <span className="ml-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                        pending
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
                    {[op.zone_name, op.station_name].filter(Boolean).join(' · ') || '—'}
                    {op.rtls_badge_id != null ? ` · badge ${op.rtls_badge_id}` : ''}
                  </p>
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-gray-600 dark:text-slate-300">
                    {formatWhen(op.entered_at)} → {formatWhen(op.left_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  )
}
