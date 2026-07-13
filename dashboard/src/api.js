// Same origin when served by Flask (port 5001). Vite dev proxies /api and /socket.io.
export const API = import.meta.env.VITE_API_URL || ''

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function apiFetch(path, { retries = 2 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API}${path}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    } catch (err) {
      lastErr = err
      if (attempt < retries) await sleep(400 * (attempt + 1))
    }
  }
  const msg = lastErr?.message?.includes('Failed to fetch')
    ? 'API unreachable — check that start.ps1 is running on port 5001'
    : (lastErr?.message || 'Request failed')
  throw new Error(msg)
}

export async function apiPost(path) {
  const res = await fetch(`${API}${path}`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function apiPut(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
