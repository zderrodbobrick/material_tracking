import { useState, useEffect, useCallback } from 'react'
import { getSocket } from '../lib/socket'

export function useSocketData(fetcher) {
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(() => getSocket().connected)

  const run = useCallback(async () => {
    try {
      const result = await fetcher()
      setData(result)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [fetcher])

  useEffect(() => {
    run()
    const socket = getSocket()

    function onUpdate() { run() }
    function onConnect()    { setConnected(true) }
    function onDisconnect() { setConnected(false) }

    socket.on('rfid_update', onUpdate)
    socket.on('connect',     onConnect)
    socket.on('disconnect',  onDisconnect)

    return () => {
      socket.off('rfid_update', onUpdate)
      socket.off('connect',     onConnect)
      socket.off('disconnect',  onDisconnect)
    }
  }, [run])

  return { data, error, loading, connected, refresh: run }
}
