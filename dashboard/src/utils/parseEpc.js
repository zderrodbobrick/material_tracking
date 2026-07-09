/**
 * EPC Tag Format & Type Code Mapping
 * ====================================
 * Tags follow this fixed structure:
 *
 *   Position:  [0]   [1 … -8]   [-7]       [-6 … -1]
 *   Field:     Qty   Part #    Type Code   Work Order #
 *
 *   Example:   1     D4         0           463947
 *
 * Full example: "1D40463947"
 *   qty         = "1"
 *   partNumber  = "D4"
 *   typeCode    = "0"
 *   typeLabel   = "IBUS"
 *   workOrder   = "463947"
 *   ibusNumber  = "1-D4-IBUS463947"
 *
 * Add new type codes to EPC_TYPE_CODES as they are discovered.
 */

const EPC_TYPE_CODES = {
  '0': 'IBUS',
  // Add future codes here, e.g.:
  // '1': 'LABEL_TYPE_1',
}

/**
 * Parse a raw decoded EPC string into its named components.
 *
 * @param {string} raw  - The raw EPC value stored in the database (e.g. "1D40463947")
 * @returns {{
 *   qty: string|null,
 *   partNumber: string|null,
 *   typeCode: string|null,
 *   typeLabel: string|null,
 *   workOrder: string|null,
 *   raw: string,
 *   formatted: string,
 *   ibusNumber: string|null,
 *   isKnown: boolean
 * }}
 */
export function parseEpc(raw) {
  if (!raw || raw.length < 7) {
    return {
      qty: null,
      partNumber: null,
      typeCode: null,
      typeLabel: null,
      workOrder: null,
      raw: raw ?? '',
      formatted: raw ?? '',
      ibusNumber: null,
      isKnown: false,
    }
  }

  const qty        = raw[0]
  const typeCode   = raw[raw.length - 7]
  const partNumber = raw.slice(1, raw.length - 7)
  const workOrder  = raw.slice(-6)
  const typeLabel  = EPC_TYPE_CODES[typeCode] ?? null
  const label      = typeLabel ?? typeCode
  const formatted  = typeLabel !== null
    ? `${qty}${partNumber}${label}${workOrder}`
    : raw
  const ibusNumber = typeLabel !== null
    ? `${qty}-${partNumber}-${label}${workOrder}`
    : null

  return {
    qty,
    partNumber,
    typeCode,
    typeLabel: label,
    workOrder,
    raw,
    formatted,
    ibusNumber,
    isKnown: typeLabel !== null,
  }
}
