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

function OperatorLine({ op, variant, liveFeed }) {
 const confirmSecs = op.confirm_seconds ?? DEFAULT_CONFIRM_SECS
 const showPending = variant === 'pending' && !liveFeed
 const [remaining, setRemaining] = useState(() =>
  showPending
   ? (op.seconds_until_confirmed ?? secondsUntilConfirmed(op.entered_at, confirmSecs))
   : 0,
 )

 useEffect(() => {
  if (!showPending || !op.entered_at) return undefined
  const tick = () => setRemaining(secondsUntilConfirmed(op.entered_at, confirmSecs))
  tick()
  const id = setInterval(tick, 250)
  return () => clearInterval(id)
 }, [showPending, op.entered_at, confirmSecs])

 const hasPos = op.x != null && op.y != null

 return (
  <div className={`leading-tight ${variant === 'pending' ? 'opacity-90' : ''}`}>
   <div className="flex items-center gap-1.5 flex-wrap">
    <span className="font-medium text-[#eef2f7]">
     {op.operator_name}
    </span>
    {showPending && remaining > 0 && (
     <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
 bg-[#4dc4f4]/15 text-[#4dc4f4]"
      title={`Confirms as worked after ${confirmSecs}s in zone`}
     >
      {Math.ceil(remaining)}s
     </span>
    )}
    {liveFeed && variant === 'pending' && (
     <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
 bg-[#4dc4f4]/15 text-[#4dc4f4]">
      in zone
     </span>
    )}
    {variant === 'worked' && (
     <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
 bg-[#34d399]/15 text-[#34d399]">
      worked
     </span>
    )}
   </div>
   {(op.station_name || op.zone_name) && (
    <span className="block text-[10px] text-[#8b939e] mt-0.5">
     {op.station_name || op.zone_name}
    </span>
   )}
   {hasPos && (
    <span className="block text-[10px] font-mono text-[#8b939e]">
     x={Number(op.x).toFixed(1)} y={Number(op.y).toFixed(1)}
    </span>
   )}
  </div>
 )
}

export function OperatorCell({ session, liveFeed = false }) {
 const present = session.operators_present ?? []
 const worked = session.operators_worked ?? []
 const hasAny = present.length > 0 || worked.length > 0

 if (hasAny) {
  return (
   <div className="space-y-2 min-w-[8rem]">
    {present.map(op => (
     <OperatorLine key={`p-${op.operator_id}`} op={op} variant="pending" liveFeed={liveFeed} />
    ))}
    {worked.map(op => (
     <OperatorLine key={`w-${op.operator_id}`} op={op} variant="worked" liveFeed={liveFeed} />
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
    liveFeed={liveFeed}
   />
  )
 }

 if (session.status === 'open' && session.rtls_match === false) {
  return (
   <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold
 bg-[#fbbf24]/15 text-[#fbbf24]">
    No operator at station
   </span>
  )
 }

 return <span className="text-[#8b939e]">—</span>
}

export { DEFAULT_CONFIRM_SECS as CONFIRM_SECS }
