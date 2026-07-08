import { io } from 'socket.io-client'
import { API } from '../api'

let socket = null

/** Shared Socket.IO connection for the whole dashboard. */
export function getSocket() {
  if (!socket) {
    socket = io(API, { transports: ['polling', 'websocket'] })
  }
  return socket
}
