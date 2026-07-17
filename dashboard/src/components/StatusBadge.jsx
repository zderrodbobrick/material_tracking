const BLUE  = 'bb-badge-blue'
const GREEN = 'bb-badge-green'
const GRAY  = 'bb-badge-muted'
const ORANGE = 'bb-badge-warn'

const STATUS_STYLES = {
 open:   BLUE,
 closed:  GREEN,
 abandoned: GRAY,
 exit_only: ORANGE,
 Entry:   BLUE,
 Exit:   GREEN,
}

const FALLBACK = GRAY

const STATUS_LABELS = {
 open:   'In Process',
 closed:  'Completed',
 abandoned: 'Abandoned',
 exit_only: 'Exit Only',
 Entry:   'Entry',
 Exit:   'Exit',
}

export function StatusBadge({ status }) {
 const style = STATUS_STYLES[status] ?? FALLBACK
 const label = STATUS_LABELS[status] ?? status
 return (
  <span className={style}>
   {label}
  </span>
 )
}
