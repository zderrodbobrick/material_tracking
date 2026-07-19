import { DwellTimer } from './DwellTimer'

const LIGHT_STYLES = {
 green: {
  dot: 'bg-[#34d399]',
  ping: 'bg-[#34d399]',
  title: 'In use — part and operator',
 },
 amber: {
  dot: 'bg-[#fbbf24]',
  ping: 'bg-[#fbbf24]',
  title: 'Part at station — no operator',
 },
 out: {
  dot: 'bg-[#8b939e]',
  ping: null,
  title: 'Out of use — no part',
 },
 idle: {
  dot: 'bg-[#2a2a32] ring-1 ring-[#3a3a44]',
  ping: null,
  title: 'Idle',
 },
}

function StatusLight({ light }) {
 const style = LIGHT_STYLES[light] ?? LIGHT_STYLES.idle

 return (
  <span
   className={`relative flex shrink-0 w-2 h-2 rounded-full ${style.dot}`}
   title={style.title}
  >
   {style.ping && light === 'green' && (
    <span className={`absolute inset-0 rounded-full animate-ping opacity-30 ${style.ping}`} />
   )}
  </span>
 )
}

function DwellCell({ entranceTime, entranceEpochMs }) {
 if (!entranceTime && entranceEpochMs == null) {
  return <span className="text-[#8b939e]">—</span>
 }
 return (
  <DwellTimer
   entranceTime={entranceTime}
   entranceEpochMs={entranceEpochMs}
   exitTime={null}
   dwellSeconds={null}
  />
 )
}

export function MachineStatusTable({ statuses, onStationClick, selectedStationKey }) {
 const inUseCount = statuses.filter(s => s.inUse).length
 const unstaffed = statuses.filter(s => s.hasPart && !s.hasOperator).length

 return (
  <div className="bb-panel w-full h-full flex flex-col min-h-0">
   <div className="bb-panel-header">
    <div className="min-w-0">
     <h2 className="bb-title">Station Status</h2>
     <p className="bb-subtitle">
      {statuses.length} stations · {inUseCount} staffed · {unstaffed} unstaffed
     </p>
    </div>
   </div>

   <div className="overflow-x-auto flex-1 min-h-0">
    <table className="bb-table">
     <thead className="bb-table-head sticky top-0 z-10">
      <tr>
       <th className="w-8" />
       <th>Station</th>
       <th>Part</th>
       <th>Part time</th>
       <th>Operator</th>
       <th>Op time</th>
      </tr>
     </thead>
     <tbody>
      {statuses.map(row => (
       <tr
        key={row.stationKey}
        className={`bb-table-row ${onStationClick ? 'cursor-pointer' : ''} ${
         selectedStationKey === row.stationKey ? 'bb-table-row-active' : ''
        } ${row.inUse ? '' : row.hasPart ? '' : 'opacity-70'}`}
        onClick={onStationClick ? () => onStationClick(row) : undefined}
       >
        <td><StatusLight light={row.light} /></td>
        <td className="font-medium text-[#eef2f7] truncate" title={row.stationName}>
         {row.stationName}
        </td>
        <td className="text-[#eef2f7] truncate" title={row.partLabel ?? undefined}>
         {row.partLabel ?? '—'}
        </td>
        <td className="whitespace-nowrap font-mono text-xs">
         <DwellCell
          entranceTime={row.partEntryTime}
          entranceEpochMs={row.partEntryEpochMs}
         />
        </td>
        <td className="text-[#eef2f7] truncate" title={row.operatorName ?? undefined}>
         {row.operatorName ?? '—'}
        </td>
        <td className="whitespace-nowrap font-mono text-xs">
         <DwellCell entranceTime={row.operatorEnteredAt} />
        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>
  </div>
 )
}
