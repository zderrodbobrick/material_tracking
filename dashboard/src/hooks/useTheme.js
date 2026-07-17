import { useEffect } from 'react'

/** Bobrick theme is fixed dark — always apply .dark for any legacy dark: utilities. */
function applyBobrickTheme() {
  document.documentElement.classList.add('dark')
}

export function useTheme() {
  useEffect(() => {
    applyBobrickTheme()
  }, [])

  return { theme: 'dark', toggleTheme: () => {}, isDark: true }
}
