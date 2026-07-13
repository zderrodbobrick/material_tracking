import { parseEpc } from './parseEpc'

/**
 * Order-level IBUS id, e.g. IBUS463947.
 * Multiple part tags (1-D4-IBUS463947, S6IBUS463947, …) share one work order.
 */
export function ibusOrderKey(sessionOrEpc, workOrder = null) {
  if (sessionOrEpc && typeof sessionOrEpc === 'object') {
    const s = sessionOrEpc
    return ibusOrderKey(s.epc ?? s.ibus_number, s.work_order ?? s.job_number)
  }

  const raw = String(sessionOrEpc ?? '').trim()
  if (workOrder) {
    const wo = String(workOrder).replace(/\D/g, '').slice(-6)
    if (wo) return `IBUS${wo}`
  }

  const p = parseEpc(raw)
  if (p.workOrder) return `IBUS${p.workOrder}`

  const m = raw.match(/IBUS(\d{6})/i)
  if (m) return `IBUS${m[1]}`

  if (raw.length >= 6 && /\d{6}$/.test(raw)) {
    return `IBUS${raw.slice(-6)}`
  }

  return raw || null
}

/** Part-level tag label, e.g. 1-D4-IBUS463947 */
export function partTagLabel(session) {
  const raw = session?.epc ?? session?.ibus_number ?? ''
  const p = parseEpc(raw)
  if (p.ibusNumber) return p.ibusNumber
  if (session?.ibus_number) return String(session.ibus_number)
  if (session?.part_number) return String(session.part_number)
  return raw || '—'
}
