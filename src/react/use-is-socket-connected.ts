import { useEffect, useState } from 'react'
import { TClientSocket } from "../client/socket.client.js";

export function useIsSocketConnected ( socket:TClientSocket ) {
  const [isConnected, setIsConnected] = useState(socket.isConnected)
  useEffect(() => {
    return socket.onConnectionUpdated.add(() => {
      setIsConnected(socket.isConnected)
    })
  }, [])
  return isConnected
}
