export function OperatorCell({ session }) {
  const name = session.operator_name
  const zone = session.operator_zone
  const method = session.assignment_method
  const hasPos = session.operator_x != null && session.operator_y != null

  if (name) {
    return (
      <div className="leading-tight">
        <span className="font-medium text-gray-800 dark:text-slate-200">{name}</span>
        {zone && (
          <span className="block text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
            {zone}
          </span>
        )}
        {hasPos && (
          <span className="block text-[10px] font-mono text-gray-400 dark:text-slate-500">
            x={Number(session.operator_x).toFixed(1)} y={Number(session.operator_y).toFixed(1)}
          </span>
        )}
        {method && (
          <span className="block text-[10px] text-blue-500/80 dark:text-blue-400/70">
            via {method.replace('_', ' ')}
          </span>
        )}
      </div>
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
