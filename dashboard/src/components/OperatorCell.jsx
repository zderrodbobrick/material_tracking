import { useEffect, useState } from 'react'

const DEFAULT_CONFIRM_SECS = 10

function parseEnteredMs(iso) {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function secondsUntilConfirmed(enteredAt, confirmSecs) {
  const enteredMs = parseEnteredMs(enteredAt)
  if (enteredMs == null) return confirmSecs
  const elapsed = (Date.now() - enteredMs) / 1000
  return Math.max(0, Math.min(confirmSecs, confirmSecs - elapsed))
}

function OperatorLine({ op, variant }) {
  const confirmSecs = op.confirm_seconds ?? DEFAULT_CONFIRM_SECS
  const [remaining, setRemaining] = useState(() =>
    variant === 'pending'
      ? (op.seconds_until_confirmed ?? secondsUntilConfirmed(op.entered_at, confirmSecs))
      : 0,
  )

  useEffect(() => {
    if (variant !== 'pending' || !op.entered_at) return undefined
    const tick = () => setRemaining(secondsUntilConfirmed(op.entered_at, confirmSecs))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [variant, op.entered_at, confirmSecs])

  const hasPos = op.x != null && op.y != null

  return (
    <div className={`leading-tight ${variant === 'pending' ? 'opacity-90' : ''}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-medium text-gray-800 dark:text-slate-200">
          {op.operator_name}
        </span>
        {variant === 'pending' && remaining > 0 && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
                       bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
            title={`Confirms as worked after ${confirmSecs}s in zone`}
          >
            {Math.ceil(remaining)}s
          </span>
        )}
        {variant === 'worked' && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
                             bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300">
            worked
          </span>
        )}
      </div>
      {(op.station_name || op.zone_name) && (
        <span className="block text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
          {op.station_name || op.zone_name}
        </span>
      )}
      {hasPos && (
        <span className="block text-[10px] font-mono text-gray-400 dark:text-slate-500">
          x={Number(op.x).toFixed(1)} y={Number(op.y).toFixed(1)}
        </span>
      )}
    </div>
  )
}

export function OperatorCell({ session }) {
  const present = session.operators_present ?? []
  const worked = session.operators_worked ?? []
  const hasAny = present.length > 0 || worked.length > 0

  if (hasAny) {
    return (
      <div className="space-y-2 min-w-[8rem]">
        {present.map(op => (
          <OperatorLine key={`p-${op.operator_id}`} op={op} variant="pending" />
        ))}
        {worked.map(op => (
          <OperatorLine key={`w-${op.operator_id}`} op={op} variant="worked" />
        ))}
      </div>
    )
  }

  const name = session.operator_name
  if (name) {
    return (
      <OperatorLine
        op={{
          operator_name: name,
          zone_name: session.operator_zone,
          x: session.operator_x,
          y: session.operator_y,
        }}
        variant={session.rtls_match === true ? 'worked' : 'pending'}
      />
    )
  }

  if (session.status === 'open' && session.rtls_match === false) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold
                         bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
        No RTLS Match
      </span>
    )
  }

  return <span className="text-gray-400 dark:text-slate-500">—</span>
}

export { DEFAULT_CONFIRM_SECS as CONFIRM_SECS }
