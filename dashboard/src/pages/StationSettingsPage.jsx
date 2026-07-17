import { useCallback, useEffect, useState } from 'react'
import {
 Settings, Factory, Save, RotateCcw, Clock, Users, Gauge,
 AlertTriangle, Route, Info,
} from 'lucide-react'
import { apiFetch, apiPut } from '../api'
import { Panel } from '../components/Panel'

function formatSeconds(sec) {
 if (sec == null || sec === '') return '—'
 const n = Number(sec)
 if (!Number.isFinite(n) || n < 0) return '—'
 if (n < 60) return `${n}s`
 const m = Math.floor(n / 60)
 const s = n % 60
 return s ? `${m}m ${s}s` : `${m}m`
}

function vsTargetBadge(pct, status) {
 if (pct == null) return null
 const cls = status === 'on_target'
  ? 'bg-[#34d399]/15 text-[#34d399]'
  : status === 'slightly_over'
   ? 'bg-[#fbbf24]/15 text-[#fbbf24]'
   : 'bg-[#f87171]/15 text-[#f87171]'
 return (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums ${cls}`}>
   {pct}% of target
  </span>
 )
}

function SpecRow({ row, onSave, saving }) {
 const [draft, setDraft] = useState(row)
 const dirty = JSON.stringify(draft) !== JSON.stringify(row)

 useEffect(() => {
  setDraft(row)
 }, [row])

 const set = (key, val) => setDraft(d => ({ ...d, [key]: val }))

 const handleSave = () => {
  onSave(draft.station_id, {
   target_part_dwell_seconds: draft.target_part_dwell_seconds === '' ? null : Number(draft.target_part_dwell_seconds),
   target_operator_dwell_seconds: draft.target_operator_dwell_seconds === '' ? null : Number(draft.target_operator_dwell_seconds),
   max_dwell_seconds: draft.max_dwell_seconds === '' ? null : Number(draft.max_dwell_seconds),
   target_pieces_per_hour: draft.target_pieces_per_hour === '' ? null : Number(draft.target_pieces_per_hour),
   progress_spine_index: draft.on_progress_spine
    ? (draft.progress_spine_index === '' ? null : Number(draft.progress_spine_index))
    : null,
   on_progress_spine: !!draft.on_progress_spine,
   notes: draft.notes ?? '',
  })
 }

 return (
  <tr className="border-b border-[#27272f]/80 align-top">
   <td className="px-3 py-3">
    <div className="font-medium text-sm text-[#eef2f7]">{draft.station_name}</div>
    <div className="text-[11px] text-[#8b939e]">{draft.station_type ?? '—'}</div>
    {draft.on_progress_spine && (
     <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-[#4dc4f4]">
      <Route className="w-3 h-3" /> Progress spine
     </span>
    )}
   </td>
   <td className="px-3 py-3">
    <label className="block text-[10px] uppercase tracking-wider text-[#8b939e] mb-1">Part dwell (sec)</label>
    <input
     type="number"
     min={0}
     value={draft.target_part_dwell_seconds ?? ''}
     onChange={e => set('target_part_dwell_seconds', e.target.value)}
     className="w-24 px-2 py-1.5 rounded-lg text-sm font-mono border border-[#27272f] 
 bg-[#08080a] text-[#eef2f7]"
    />
    <p className="text-[10px] text-[#8b939e] mt-1">{formatSeconds(draft.target_part_dwell_seconds)} target</p>
    {draft.actual_part_dwell_seconds != null && (
     <div className="mt-1 space-y-0.5">
      <p className="text-[10px] text-[#8b939e]">Actual: {formatSeconds(draft.actual_part_dwell_seconds)}</p>
      {vsTargetBadge(draft.vs_target_pct, draft.vs_target_status)}
     </div>
    )}
   </td>
   <td className="px-3 py-3">
    <label className="block text-[10px] uppercase tracking-wider text-[#8b939e] mb-1">Operator dwell (sec)</label>
    <input
     type="number"
     min={0}
     value={draft.target_operator_dwell_seconds ?? ''}
     onChange={e => set('target_operator_dwell_seconds', e.target.value)}
     className="w-24 px-2 py-1.5 rounded-lg text-sm font-mono border border-[#27272f] 
 bg-[#08080a] text-[#eef2f7]"
    />
    <p className="text-[10px] text-[#8b939e] mt-1">{formatSeconds(draft.target_operator_dwell_seconds)} target</p>
    {draft.actual_operator_dwell_seconds != null && (
     <div className="mt-1 space-y-0.5">
      <p className="text-[10px] text-[#8b939e]">Actual: {formatSeconds(draft.actual_operator_dwell_seconds)}</p>
      {vsTargetBadge(draft.operator_vs_target_pct, draft.operator_vs_target_status)}
     </div>
    )}
   </td>
   <td className="px-3 py-3">
    <label className="block text-[10px] uppercase tracking-wider text-[#8b939e] mb-1">Max alert (sec)</label>
    <input
     type="number"
     min={0}
     value={draft.max_dwell_seconds ?? ''}
     onChange={e => set('max_dwell_seconds', e.target.value)}
     className="w-24 px-2 py-1.5 rounded-lg text-sm font-mono border border-[#27272f] 
 bg-[#08080a] text-[#eef2f7]"
    />
    <p className="text-[10px] text-[#8b939e] mt-1 flex items-center gap-1">
     <AlertTriangle className="w-3 h-3" /> Slow-part flag
    </p>
   </td>
   <td className="px-3 py-3">
    <label className="block text-[10px] uppercase tracking-wider text-[#8b939e] mb-1">Pieces / hr</label>
    <input
     type="number"
     min={0}
     step={0.5}
     value={draft.target_pieces_per_hour ?? ''}
     onChange={e => set('target_pieces_per_hour', e.target.value)}
     className="w-20 px-2 py-1.5 rounded-lg text-sm font-mono border border-[#27272f] 
 bg-[#08080a] text-[#eef2f7]"
    />
   </td>
   <td className="px-3 py-3">
    <label className="flex items-center gap-2 text-sm cursor-pointer">
     <input
      type="checkbox"
      checked={!!draft.on_progress_spine}
      onChange={e => set('on_progress_spine', e.target.checked)}
      className="rounded border-[#27272f] text-[#a78bfa] focus:ring-violet-500"
     />
     <span className="text-xs text-[#8b939e] dark:text-[#8b939e]">On spine</span>
    </label>
    {draft.on_progress_spine && (
     <div className="mt-2">
      <label className="block text-[10px] uppercase tracking-wider text-[#8b939e] mb-1">Order (1 = first)</label>
      <input
       type="number"
       min={1}
       value={draft.progress_spine_index == null || draft.progress_spine_index === ''
         ? ''
         : Number(draft.progress_spine_index) + 1}
       onChange={e => {
         const raw = e.target.value
         set('progress_spine_index', raw === '' ? '' : Math.max(0, Number(raw) - 1))
       }}
       className="w-16 px-2 py-1.5 rounded-lg text-sm font-mono bb-input"
      />
     </div>
    )}
   </td>
   <td className="px-3 py-3 min-w-[8rem]">
    <input
     type="text"
     value={draft.notes ?? ''}
     onChange={e => set('notes', e.target.value)}
     placeholder="Notes…"
     className="w-full px-2 py-1.5 rounded-lg text-xs border border-[#27272f] 
 bg-[#08080a] text-[#eef2f7]"
    />
   </td>
   <td className="px-3 py-3">
    <button
     type="button"
     disabled={!dirty || saving}
     onClick={handleSave}
     className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                bg-[#4dc4f4] text-[#08080a] hover:bg-[#6dd0f7] disabled:opacity-40 disabled:cursor-not-allowed"
    >
     <Save className="w-3.5 h-3.5" />
     Save
    </button>
    {dirty && (
     <button
      type="button"
      onClick={() => setDraft(row)}
      className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#8b939e] hover:text-[#8b939e]"
     >
      <RotateCcw className="w-3 h-3" /> Reset
     </button>
    )}
   </td>
  </tr>
 )
}

export function StationSettingsPage() {
 const [data, setData] = useState(null)
 const [error, setError] = useState(null)
 const [savingId, setSavingId] = useState(null)

 const load = useCallback(() => {
  apiFetch('/api/station-specifications')
   .then(d => { setData(d); setError(null) })
   .catch(e => setError(e?.message || 'Failed to load station settings'))
 }, [])

 useEffect(() => { load() }, [load])

 const handleSave = async (stationId, payload) => {
  setSavingId(stationId)
  try {
   const updated = await apiPut(`/api/station-specifications/${stationId}`, payload)
   setData(prev => ({
    ...prev,
    specifications: (prev?.specifications ?? []).map(s =>
     s.station_id === stationId ? updated : s,
    ),
   }))
  } catch (e) {
   setError(e?.message || 'Save failed')
  } finally {
   setSavingId(null)
  }
 }

 const specs = data?.specifications ?? []
 const spine = data?.progress_spine ?? []

 const sortedSpecs = [...specs].sort((a, b) => {
  const spineIdx = (r) => {
    if (!r.on_progress_spine) return 999
    return r.progress_spine_index == null ? 998 : Number(r.progress_spine_index)
  }
  const da = spineIdx(a)
  const db = spineIdx(b)
  if (da !== db) return da - db
  return (a.station_id ?? 0) - (b.station_id ?? 0)
 })

 return (
  <div className="space-y-6 max-w-[1400px] mx-auto">
   <div className="flex flex-wrap items-start gap-4">
    <div>
     <h1 className="text-xl font-bold text-[#eef2f7] flex items-center gap-2">
      <Settings className="w-6 h-6 text-[#4dc4f4]" />
      Machine Analytics Settings
     </h1>
     <p className="text-sm text-[#8b939e] mt-1 max-w-2xl">
      Set normal dwell targets per machine. IBUS progress bars use a{' '}
      <strong className="font-medium text-[#eef2f7]">weighted average</strong>{' '}
      based on part dwell targets along the progress spine — longer stations count more toward completion.
     </p>
    </div>
   </div>

   <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div className="rounded-xl border border-[#4dc4f4]/30 bg-[#4dc4f4]/10 p-4">
     <div className="flex items-center gap-2 text-[#4dc4f4] font-semibold text-sm">
      <Clock className="w-4 h-4" /> Part dwell target
     </div>
     <p className="text-xs text-[#8b939e] mt-2">
      Expected average time a part spends at this machine. Drives weighted IBUS progress and “vs target” analytics.
     </p>
    </div>
    <div className="rounded-xl border border-[#4dc4f4]/30 bg-[#4dc4f4]/5 p-4">
     <div className="flex items-center gap-2 text-[#4dc4f4] font-semibold text-sm">
      <Users className="w-4 h-4" /> Operator dwell target
     </div>
     <p className="text-xs text-[#8b939e] mt-2">
      Normal RTLS presence time for an operator at this station. Compare against zone visit history on the Operators page.
     </p>
    </div>
    <div className="rounded-xl border border-[#fbbf24]/30 bg-[#fbbf24]/10 p-4">
     <div className="flex items-center gap-2 text-[#fbbf24] font-semibold text-sm">
      <Gauge className="w-4 h-4" /> Other useful fields
     </div>
     <p className="text-xs text-[#8b939e] mt-2">
      <strong className="text-[#eef2f7]">Max alert</strong> flags slow parts. <strong className="text-[#eef2f7]">Pieces/hr</strong> is a throughput goal.
      <strong className="text-[#eef2f7]"> Progress spine</strong> defines which machines count toward IBUS % and in what order.
     </p>
    </div>
   </div>

   {spine.length > 0 && (
    <Panel title="Progress Spine" icon={Route} iconColor="bb-accent-icon"
        subtitle="Production order for weighted IBUS completion (left → right)">
     <div className="px-5 py-4 flex flex-wrap items-center gap-2">
      {spine.map((name, i) => (
       <span key={name} className="inline-flex items-center gap-1.5">
        {i > 0 && <span className="text-[#4dc4f4]">→</span>}
        <span className="px-3 py-1.5 rounded-lg text-xs font-semibold
                         bg-[#4dc4f4]/15 text-[#4dc4f4] border border-[#4dc4f4]/35">
         {i + 1}. {name}
        </span>
       </span>
      ))}
     </div>
    </Panel>
   )}

   {error && (
    <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171] px-4 py-3 text-sm flex items-center gap-2">
     <Info className="w-4 h-4 shrink-0" /> {error}
    </div>
   )}

   <Panel title="All Machines" icon={Factory} iconColor="text-[#4dc4f4]"
       subtitle="Edit targets and save each row — changes apply immediately to progress and analytics">
    {!data ? (
     <p className="text-sm text-[#8b939e] py-10 text-center">Loading…</p>
    ) : (
     <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[960px]">
       <thead>
        <tr className="text-left bg-[#08080a] border-b border-[#27272f]">
         {['Machine', 'Part target', 'Operator target', 'Max alert', 'Throughput', 'Progress', 'Notes', ''].map(h => (
          <th key={h} className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-[#8b939e]">{h}</th>
         ))}
        </tr>
       </thead>
       <tbody>
        {sortedSpecs.map(row => (
         <SpecRow
          key={row.station_id}
          row={row}
          onSave={handleSave}
          saving={savingId === row.station_id}
         />
        ))}
       </tbody>
      </table>
     </div>
    )}
   </Panel>
  </div>
 )
}
