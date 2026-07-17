import { Sun, Moon } from 'lucide-react'

export function ThemeToggle({ isDark, onToggle }) {
 return (
  <button
   type="button"
   onClick={onToggle}
   role="switch"
   aria-checked={isDark}
   aria-label="Toggle dark mode"
   title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
   className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-full p-1
         transition-colors duration-300 focus:outline-none focus-visible:ring-2
         focus-visible:ring-[#4dc4f4] focus-visible:ring-offset-2
         focus-visible:ring-offset-transparent
         ${isDark
          ? 'bg-[#4dc4f4] hover:bg-[#6dd0f7] text-[#08080a]'
          : 'bg-sky-300 hover:bg-sky-400'}`}
  >
   {/* Track icons */}
   <Sun
    className={`absolute left-1.5 w-4 h-4 transition-all duration-300
          ${isDark ? 'opacity-40 text-slate-400 scale-90' : 'opacity-100 text-amber-600 scale-100'}`}
   />
   <Moon
    className={`absolute right-1.5 w-4 h-4 transition-all duration-300
          ${isDark ? 'opacity-100 text-blue-300 scale-100' : 'opacity-40 text-slate-100 scale-90'}`}
   />

   {/* Sliding knob */}
   <span
    className={`relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full
          bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]
          ${isDark ? 'translate-x-8' : 'translate-x-0'}`}
   >
    {isDark
     ? <Moon className="w-3.5 h-3.5 text-slate-700" />
     : <Sun className="w-3.5 h-3.5 text-[#fbbf24]" />}
   </span>
  </button>
 )
}
