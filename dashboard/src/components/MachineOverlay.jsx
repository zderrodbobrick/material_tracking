import { machineBoundsToPercent } from '../utils/machineRegions'

export function MachineOverlay({ machine, partCount, operatorCount, isActive, onClick }) {
  const bounds = machineBoundsToPercent(machine)
  const badge = partCount > 0 || operatorCount > 0

  return (
    <button
      type="button"
      aria-label={`${machine.name} — ${partCount} part${partCount !== 1 ? 's' : ''}, ${operatorCount} operator${operatorCount !== 1 ? 's' : ''}`}
      onClick={onClick}
      className={`absolute z-[15] rounded-sm cursor-pointer transition-all duration-150
                  border-2 pointer-events-auto group/machine
                  ${isActive
                    ? 'border-violet-400 bg-violet-500/25 shadow-[0_0_16px_rgba(139,92,246,0.45)]'
                    : 'border-violet-400/25 bg-violet-500/5 hover:border-violet-400/70 hover:bg-violet-500/15'
                  }`}
      style={bounds}
    >
      {badge && (
        <span
          className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap
                     px-2 py-0.5 rounded-full text-[10px] font-semibold
                     bg-violet-600 text-white shadow-md border border-violet-400/50
                     pointer-events-none"
        >
          {partCount > 0 && `${partCount} part${partCount !== 1 ? 's' : ''}`}
          {partCount > 0 && operatorCount > 0 && ' · '}
          {operatorCount > 0 && `${operatorCount} op${operatorCount !== 1 ? 's' : ''}`}
        </span>
      )}
      <span
        className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wider
                    px-1.5 py-0.5 rounded pointer-events-none transition-opacity
                    ${isActive
                      ? 'bg-violet-600/90 text-white opacity-100'
                      : 'bg-black/60 text-white/90 opacity-0 group-hover/machine:opacity-100'
                    }`}
      >
        {machine.name}
      </span>
    </button>
  )
}
