import { useCallback, useEffect, useMemo, useState } from 'react'
import { GripVertical, HelpCircle } from 'lucide-react'
import { apiFetch, apiPut } from '../api'
import { FloorPlanEditor } from '../components/FloorPlanEditor'

/** Seed defaults mirrored from tracking/station_specs.py */
const SPINE_DEFAULTS = {
 Tenoner: { target_part_dwell_seconds: 180, target_operator_dwell_seconds: 60, max_dwell_seconds: 600, target_pieces_per_hour: 8, progress_spine_index: 0, on_progress_spine: true },
 Tennoner: { target_part_dwell_seconds: 180, target_operator_dwell_seconds: 60, max_dwell_seconds: 600, target_pieces_per_hour: 8, progress_spine_index: 0, on_progress_spine: true },
 LBD: { target_part_dwell_seconds: 90, target_operator_dwell_seconds: 30, max_dwell_seconds: 300, target_pieces_per_hour: 12, progress_spine_index: 1, on_progress_spine: true },
 Gannomat: { target_part_dwell_seconds: 120, target_operator_dwell_seconds: 45, max_dwell_seconds: 480, target_pieces_per_hour: 10, progress_spine_index: 2, on_progress_spine: true },
 'Insert Station': { target_part_dwell_seconds: 60, target_operator_dwell_seconds: 30, max_dwell_seconds: 240, target_pieces_per_hour: 15, progress_spine_index: 3, on_progress_spine: true },
 Anderson: { target_part_dwell_seconds: 150, target_operator_dwell_seconds: 45, max_dwell_seconds: 480, target_pieces_per_hour: null, progress_spine_index: null, on_progress_spine: false },
}

const FALLBACK_DEFAULTS = {
 target_part_dwell_seconds: 120,
 target_operator_dwell_seconds: 45,
 max_dwell_seconds: 480,
 target_pieces_per_hour: null,
 progress_spine_index: null,
 on_progress_spine: false,
}

const COLUMNS = [
 { key: 'machine', label: 'Machine' },
 {
  key: 'part',
  label: 'Part dwell target',
  tip: 'Expected average time a part spends at this machine. Used for weighted IBUS progress and vs-target analytics.',
 },
 {
  key: 'operator',
  label: 'Operator dwell target',
  tip: 'Normal RTLS presence time for an operator at this station.',
 },
 {
  key: 'alert',
  label: 'Slow-part threshold',
  tip: 'Flag parts that dwell longer than this duration.',
 },
 {
  key: 'throughput',
  label: 'Target parts/hour',
  tip: 'Throughput goal for this station. Leave blank if not configured.',
 },
 {
  key: 'in_flow',
  label: 'In flow',
  tip: 'Include this station in the production sequence used for IBUS progress.',
 },
 { key: 'notes', label: 'Notes' },
]

function formatSeconds(sec) {
 if (sec == null || sec === '') return '—'
 const n = Number(sec)
 if (!Number.isFinite(n) || n < 0) return '—'
 if (n === 0) return '0 sec'
 if (n < 60) return `${n} sec`
 const m = Math.floor(n / 60)
 const s = n % 60
 if (s === 0) return `${m} min`
 return `${m} min ${s} sec`
}

function secondsToParts(sec) {
 if (sec == null || sec === '') return { min: '', sec: '' }
 const n = Number(sec)
 if (!Number.isFinite(n) || n < 0) return { min: '', sec: '' }
 return { min: String(Math.floor(n / 60)), sec: String(n % 60) }
}

function partsToSeconds(min, sec) {
 if (min === '' && sec === '') return null
 const m = min === '' ? 0 : Number(min)
 const s = sec === '' ? 0 : Number(sec)
 if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0) return null
 return Math.round(m * 60 + s)
}

function Tip({ text }) {
 if (!text) return null
 return (
  <span className="inline-flex ml-1 align-middle text-[#5c6370] hover:text-[#8b939e]" title={text}>
   <HelpCircle className="w-3 h-3" />
  </span>
 )
}

function DurationField({ value, onChange, ariaLabel }) {
 const parts = secondsToParts(value)
 const [min, setMin] = useState(parts.min)
 const [sec, setSec] = useState(parts.sec)

 useEffect(() => {
  const p = secondsToParts(value)
  setMin(p.min)
  setSec(p.sec)
 }, [value])

 const commit = (nextMin, nextSec) => {
  onChange(partsToSeconds(nextMin, nextSec))
 }

 return (
  <div className="space-y-1">
   <div className="flex items-center gap-1" aria-label={ariaLabel}>
    <input
     type="number"
     min={0}
     value={min}
     onChange={e => {
      setMin(e.target.value)
      commit(e.target.value, sec)
     }}
     className="bb-field-input w-12 text-center"
     placeholder="0"
    />
    <span className="text-[11px] text-[#8b939e]">min</span>
    <input
     type="number"
     min={0}
     max={59}
     value={sec}
     onChange={e => {
      setSec(e.target.value)
      commit(min, e.target.value)
     }}
     className="bb-field-input w-12 text-center"
     placeholder="0"
    />
    <span className="text-[11px] text-[#8b939e]">sec</span>
   </div>
   <p className="text-xs text-[#eef2f7]/80 tabular-nums">{formatSeconds(value)}</p>
  </div>
 )
}

function vsTargetBadge(pct, status) {
 if (pct == null) return null
 const cls = status === 'on_target'
  ? 'bb-badge-green'
  : status === 'slightly_over'
   ? 'bb-badge-warn'
   : 'bb-badge-danger'
 return (
  <span className={`${cls} mt-1`}>
   {pct}% of target
  </span>
 )
}

function editablePayload(row) {
 return {
  target_part_dwell_seconds: row.target_part_dwell_seconds,
  target_operator_dwell_seconds: row.target_operator_dwell_seconds,
  max_dwell_seconds: row.max_dwell_seconds,
  target_pieces_per_hour: row.target_pieces_per_hour,
  progress_spine_index: row.on_progress_spine
   ? (row.progress_spine_index == null || row.progress_spine_index === '' ? null : Number(row.progress_spine_index))
   : null,
  on_progress_spine: !!row.on_progress_spine,
  notes: row.notes ?? '',
 }
}

function normalizeRow(row) {
 const thr = row.target_pieces_per_hour
 return {
  ...row,
  on_progress_spine: !!row.on_progress_spine,
  // Treat 0 throughput as unset unless it was intentionally configured
  target_pieces_per_hour: thr === 0 || thr === '0' ? null : thr,
  notes: row.notes ?? '',
 }
}

function defaultsForStation(name) {
 const seed = SPINE_DEFAULTS[name] ?? FALLBACK_DEFAULTS
 return { ...seed }
}

export function StationSettingsPage() {
 const [baseline, setBaseline] = useState([])
 const [drafts, setDrafts] = useState([])
 const [error, setError] = useState(null)
 const [saving, setSaving] = useState(false)
 const [editOrder, setEditOrder] = useState(false)
 const [dragId, setDragId] = useState(null)
 const [statusMsg, setStatusMsg] = useState(null)

 const load = useCallback(() => {
  apiFetch('/api/station-specifications')
   .then(d => {
    const rows = (d.specifications ?? []).map(normalizeRow)
    setBaseline(rows)
    setDrafts(rows.map(r => ({ ...r })))
    setError(null)
   })
   .catch(e => setError(e?.message || 'Failed to load station settings'))
 }, [])

 useEffect(() => { load() }, [load])

 useEffect(() => {
  if (!statusMsg) return
  const t = setTimeout(() => setStatusMsg(null), 3000)
  return () => clearTimeout(t)
 }, [statusMsg])

 const dirty = useMemo(() => {
  if (baseline.length !== drafts.length) return true
  const byId = new Map(baseline.map(r => [r.station_id, r]))
  return drafts.some(d => {
   const b = byId.get(d.station_id)
   if (!b) return true
   return JSON.stringify(editablePayload(d)) !== JSON.stringify(editablePayload(b))
  })
 }, [baseline, drafts])

 const dirtyIds = useMemo(() => {
  const byId = new Map(baseline.map(r => [r.station_id, r]))
  return new Set(
   drafts
    .filter(d => {
     const b = byId.get(d.station_id)
     if (!b) return true
     return JSON.stringify(editablePayload(d)) !== JSON.stringify(editablePayload(b))
    })
    .map(d => d.station_id),
  )
 }, [baseline, drafts])

 const updateDraft = (stationId, patch) => {
  setDrafts(prev => prev.map(r => (r.station_id === stationId ? { ...r, ...patch } : r)))
 }

 const spineRows = useMemo(() => {
  return drafts
   .filter(r => r.on_progress_spine)
   .sort((a, b) => {
    const ia = a.progress_spine_index == null ? 999 : Number(a.progress_spine_index)
    const ib = b.progress_spine_index == null ? 999 : Number(b.progress_spine_index)
    if (ia !== ib) return ia - ib
    return (a.station_id ?? 0) - (b.station_id ?? 0)
   })
 }, [drafts])

 const sortedDrafts = useMemo(() => {
  return [...drafts].sort((a, b) => {
   const spineIdx = (r) => {
    if (!r.on_progress_spine) return 999
    return r.progress_spine_index == null ? 998 : Number(r.progress_spine_index)
   }
   const da = spineIdx(a)
   const db = spineIdx(b)
   if (da !== db) return da - db
   return (a.station_id ?? 0) - (b.station_id ?? 0)
  })
 }, [drafts])

 const reindexSpine = (orderedIds) => {
  setDrafts(prev => prev.map(r => {
   const idx = orderedIds.indexOf(r.station_id)
   if (idx >= 0) {
    return { ...r, on_progress_spine: true, progress_spine_index: idx }
   }
   if (r.on_progress_spine) {
    return { ...r, on_progress_spine: false, progress_spine_index: null }
   }
   return r
  }))
 }

 const toggleInFlow = (stationId, on) => {
  setDrafts(prev => {
   const current = prev
    .filter(r => r.on_progress_spine && r.station_id !== stationId)
    .sort((a, b) => (a.progress_spine_index ?? 999) - (b.progress_spine_index ?? 999))
   const ids = current.map(r => r.station_id)
   if (on) ids.push(stationId)
   return prev.map(r => {
    const idx = ids.indexOf(r.station_id)
    if (idx >= 0) return { ...r, on_progress_spine: true, progress_spine_index: idx }
    return { ...r, on_progress_spine: false, progress_spine_index: null }
   })
  })
 }

 const handleDragStart = (stationId) => setDragId(stationId)

 const handleDropOn = (targetId) => {
  if (dragId == null || dragId === targetId) {
   setDragId(null)
   return
  }
  const ids = spineRows.map(r => r.station_id)
  const from = ids.indexOf(dragId)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0) {
   setDragId(null)
   return
  }
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, dragId)
  reindexSpine(next)
  setDragId(null)
 }

 const discardChanges = () => {
  setDrafts(baseline.map(r => ({ ...r })))
  setEditOrder(false)
  setStatusMsg('Changes discarded')
 }

 const resetDefaults = () => {
  setDrafts(prev => prev.map(r => {
   const d = defaultsForStation(r.station_name)
   return {
    ...r,
    target_part_dwell_seconds: d.target_part_dwell_seconds,
    target_operator_dwell_seconds: d.target_operator_dwell_seconds,
    max_dwell_seconds: d.max_dwell_seconds,
    target_pieces_per_hour: d.target_pieces_per_hour,
    progress_spine_index: d.progress_spine_index,
    on_progress_spine: !!d.on_progress_spine,
   }
  }))
  setStatusMsg('Defaults applied — save to persist')
 }

 const saveChanges = async () => {
  if (!dirtyIds.size) return
  setSaving(true)
  setError(null)
  try {
   const results = await Promise.all(
    drafts
     .filter(d => dirtyIds.has(d.station_id))
     .map(async (d) => {
      const updated = await apiPut(
       `/api/station-specifications/${d.station_id}`,
       editablePayload(d),
      )
      return normalizeRow(updated)
     }),
   )
   const byId = new Map(results.map(r => [r.station_id, r]))
   setBaseline(prev => prev.map(r => byId.get(r.station_id) ?? r))
   setDrafts(prev => prev.map(r => byId.get(r.station_id) ?? r))
   setEditOrder(false)
   setStatusMsg(`Saved ${results.length} machine${results.length === 1 ? '' : 's'}`)
  } catch (e) {
   setError(e?.message || 'Save failed')
  } finally {
   setSaving(false)
  }
 }

 return (
  <div className="space-y-5 w-full max-w-[1800px]">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
     <h1 className="bb-page-title">Machine Analytics Settings</h1>
     <p className="bb-page-sub max-w-2xl">
      Configure expected part and operator dwell times, alert thresholds, throughput goals, and production order.
     </p>
    </div>
    <div className="flex flex-wrap items-center gap-2 shrink-0">
     {dirty && (
      <span className="text-xs text-[#fbbf24] mr-1">Unsaved changes</span>
     )}
     <button
      type="button"
      onClick={discardChanges}
      disabled={!dirty || saving}
      className="bb-btn-outline disabled:opacity-40"
     >
      Discard changes
     </button>
     <button
      type="button"
      onClick={resetDefaults}
      disabled={saving}
      className="bb-btn-outline disabled:opacity-40"
     >
      Reset defaults
     </button>
     <button
      type="button"
      onClick={saveChanges}
      disabled={!dirty || saving}
      className="bb-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
     >
      {saving ? 'Saving…' : 'Save changes'}
     </button>
    </div>
   </div>

   {statusMsg && (
    <p className="text-xs text-[#8b939e]">{statusMsg}</p>
   )}

   {error && (
    <div className="border border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171] px-3 py-2 text-sm rounded-[6px]">
     {error}
    </div>
   )}

   <section className="bb-section">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <h2 className="bb-section-title">Production flow</h2>
     <button
      type="button"
      onClick={() => setEditOrder(v => !v)}
      className={`bb-btn-outline ${editOrder ? 'bb-btn-outline-active' : ''}`}
     >
      {editOrder ? 'Done' : 'Edit order'}
     </button>
    </div>
    {spineRows.length === 0 ? (
     <p className="text-sm text-[#8b939e] py-2">
      No stations in the production flow. Enable <span className="text-[#eef2f7]">In flow</span> on a machine below.
     </p>
    ) : (
     <div className="bb-panel px-3 py-3 flex flex-wrap items-center gap-1.5">
      {spineRows.map((row, i) => (
       <span key={row.station_id} className="inline-flex items-center gap-1.5">
        {i > 0 && <span className="text-[#5c6370] select-none">→</span>}
        <span
         draggable={editOrder}
         onDragStart={() => handleDragStart(row.station_id)}
         onDragOver={e => { if (editOrder) e.preventDefault() }}
         onDrop={() => handleDropOn(row.station_id)}
         className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-[6px]
                     border border-[#2a2a32] bg-[#111114] text-[#eef2f7]
                     ${editOrder ? 'cursor-grab active:cursor-grabbing' : ''}
                     ${dragId === row.station_id ? 'border-[#4dc4f4] bg-[#4dc4f4]/10' : ''}`}
        >
         {editOrder && <GripVertical className="w-3 h-3 text-[#5c6370]" />}
         {row.station_name}
        </span>
       </span>
      ))}
     </div>
    )}
    {editOrder && (
     <p className="text-[11px] text-[#8b939e]">
      Drag stations to reorder. Use In flow in the table to add or remove machines.
     </p>
    )}
   </section>

   <section className="bb-section">
    <h2 className="bb-section-title">Machine settings</h2>
    {!baseline.length && !error ? (
     <p className="bb-empty">Loading…</p>
    ) : (
     <div className="bb-table-wrap">
      <table className="bb-table min-w-[980px]">
       <thead className="bb-table-head">
        <tr>
         {COLUMNS.map(col => (
          <th key={col.key}>
           {col.label}
           <Tip text={col.tip} />
          </th>
         ))}
        </tr>
       </thead>
       <tbody>
        {sortedDrafts.map(row => {
         const isDirty = dirtyIds.has(row.station_id)
         const thr = row.target_pieces_per_hour
         return (
          <tr
           key={row.station_id}
           className={`bb-table-row align-top ${isDirty ? 'bb-table-row-active' : ''}`}
          >
           <td>
            <div className="font-medium text-sm text-[#eef2f7]">{row.station_name}</div>
            <div className="text-[11px] text-[#8b939e]">{row.station_type ?? '—'}</div>
           </td>
           <td>
            <DurationField
             value={row.target_part_dwell_seconds}
             onChange={v => updateDraft(row.station_id, { target_part_dwell_seconds: v })}
             ariaLabel="Part dwell target"
            />
            {row.actual_part_dwell_seconds != null && (
             <div className="mt-1 space-y-0.5">
              <p className="text-[10px] text-[#8b939e]">
               Actual: {formatSeconds(row.actual_part_dwell_seconds)}
              </p>
              {vsTargetBadge(row.vs_target_pct, row.vs_target_status)}
             </div>
            )}
           </td>
           <td>
            <DurationField
             value={row.target_operator_dwell_seconds}
             onChange={v => updateDraft(row.station_id, { target_operator_dwell_seconds: v })}
             ariaLabel="Operator dwell target"
            />
            {row.actual_operator_dwell_seconds != null && (
             <div className="mt-1 space-y-0.5">
              <p className="text-[10px] text-[#8b939e]">
               Actual: {formatSeconds(row.actual_operator_dwell_seconds)}
              </p>
              {vsTargetBadge(row.operator_vs_target_pct, row.operator_vs_target_status)}
             </div>
            )}
           </td>
           <td>
            <DurationField
             value={row.max_dwell_seconds}
             onChange={v => updateDraft(row.station_id, { max_dwell_seconds: v })}
             ariaLabel="Slow-part threshold"
            />
           </td>
           <td>
            <input
             type="number"
             min={0}
             step={0.5}
             value={thr == null || thr === '' ? '' : thr}
             onChange={e => {
              const raw = e.target.value
              updateDraft(row.station_id, {
               target_pieces_per_hour: raw === '' ? null : Number(raw),
              })
             }}
             placeholder="Not set"
             className="bb-field-input w-20"
            />
            {(thr == null || thr === '') && (
             <p className="text-[11px] text-[#8b939e] mt-1">Not set</p>
            )}
           </td>
           <td>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
             <input
              type="checkbox"
              checked={!!row.on_progress_spine}
              onChange={e => toggleInFlow(row.station_id, e.target.checked)}
              className="rounded border-[#3a3a44] bg-[#08080a] text-[#4dc4f4] focus:ring-[#4dc4f4]"
             />
             <span className="text-xs text-[#eef2f7]">
              {row.on_progress_spine ? 'Yes' : 'No'}
             </span>
            </label>
            {row.on_progress_spine && (
             <p className="text-[11px] text-[#8b939e] mt-1 tabular-nums">
              Order {(Number(row.progress_spine_index) || 0) + 1}
             </p>
            )}
           </td>
           <td className="min-w-[8rem]">
            <input
             type="text"
             value={row.notes ?? ''}
             onChange={e => updateDraft(row.station_id, { notes: e.target.value })}
             placeholder="—"
             className="bb-field-input w-full text-xs"
            />
           </td>
          </tr>
         )
        })}
       </tbody>
      </table>
     </div>
    )}
   </section>

   <FloorPlanEditor />
  </div>
 )
}
