// Same origin when served by Flask (port 5001). Vite dev proxies /api and /socket.io.
export const API = import.meta.env.VITE_API_URL || ''

export async function apiFetch(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function apiPost(path) {
  const res = await fetch(`${API}${path}`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}
