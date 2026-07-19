export function Panel({ title, subtitle, icon: Icon, iconColor = 'bb-accent-icon', right, children, className = '' }) {
 return (
  <div className={`bb-panel ${className}`}>
   {(title || right) && (
    <div className="bb-panel-header">
     <div className="min-w-0">
      {title && (
       <h2 className="bb-title">
        {Icon && <Icon className={`w-3.5 h-3.5 ${iconColor}`} />}
        {title}
       </h2>
      )}
      {subtitle && <p className="bb-subtitle">{subtitle}</p>}
     </div>
     {right}
    </div>
   )}
   {children}
  </div>
 )
}
