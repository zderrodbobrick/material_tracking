export const API = 'http://localhost:5001'

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
