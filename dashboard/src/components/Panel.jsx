export function Panel({ title, subtitle, icon: Icon, iconColor = 'text-blue-500 dark:text-blue-400', right, children, className = '' }) {
  return (
    <div className={`animate-fade-in rounded-xl shadow-sm overflow-hidden
                     bg-white border border-gray-200
                     dark:bg-slate-800/60 dark:border-slate-700/60 ${className}`}>
      {(title || right) && (
        <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-700/60
                        flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100">
                {Icon && <Icon className={`w-4 h-4 ${iconColor}`} />}
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}
