import { generateSimpleUID } from '../common/random.js'
import { Emitter } from "../common/emitter.js";
import { ISocketPayload } from "../common/index.common.js";


interface TOptions {
  endpoint          : string
  logsLevel         ?:TLogsLevel
  reconnectTimeout  ?:number
  payloadTimeout    ?:number
}

type TLogsLevel = 0 | 1 | 2

export type TClientSocket = ReturnType<typeof createClientSocket>

export function createClientSocket (options:TOptions) {
  // Extract options
  let { endpoint, reconnectTimeout, payloadTimeout, logsLevel } = options
  // Check endpoint
  if ( !endpoint.startsWith("ws://") && !endpoint.startsWith("wss://") ) {
    throw new Error('Invalid endpoint')
  }
  // Logs level
  logsLevel ||= 0
  // Socket state
  let _webSocket: WebSocket | null
  let _isConnected = false
  // Reconnection management
  reconnectTimeout ||= 1000
  let _reconnectionTimeout: any
  let _allowReconnexions = true
  // Waiting payload returns
  payloadTimeout ||= 10 * 1000 // 10 seconds
  const _waitingPayloadReturns: any[] = []

  // --------------------------------------------------------------------------- PUBLIC API
  const api = {
    /**
     * Set logs level.
     * 0: No logs
     * 1: Payload logs
     * 2: Verbose with raw logs
     * @param level
     */
    set logsLevel (level:TLogsLevel) {
      if ( level < 0 || level > 2 )
        throw new Error('Invalid logs level')
      logsLevel = level
    },
    get logsLevel ():TLogsLevel { return logsLevel },

    /**
     * Get connected status
     */
    get isConnected () { return _isConnected },

    /**
     * Listen when the connexion state changes
     */
    onConnectionUpdated: Emitter<[boolean]>(),

    /**
     * Listen when we receive a payload
     */
    onPayload: Emitter<[ISocketPayload]>(),

    // ------------------------------------------------------------------------- CONNECT

    connect ():boolean {
      // Already connected or exited
      if (_isConnected || !_allowReconnexions)
        return false
      // Remove reconnect timeout
      clearTimeout(_reconnectionTimeout)
      _reconnectionTimeout = null
      // Compute socket endpoint from protocol and party code
      _webSocket = new WebSocket(endpoint)
      // We are connected
      _webSocket.addEventListener('open', () => {
        if ( logsLevel >= 1 )
          console.log('WS :: open')
        _isConnected = true
        api.onConnectionUpdated.dispatch(_isConnected)
      })
      // We receive a payload from server
      _webSocket.addEventListener('message', (event) => {
        if (typeof event.type !== 'string') {
          if ( logsLevel >= 1 )
            console.error('WS :: Invalid message type', event)
          return
        }
        // This is a ping
        if (event.data.startsWith('@')) {
          if ( logsLevel >= 2 )
            console.log(`WS -> ${event.data}`)
          return
        }
        // Parse it as json
        if ( logsLevel >= 2 )
          console.log('WS <-', event.data)
        let parsedPayload
        try {
          parsedPayload = JSON.parse(event.data)
        } catch (error) {
          if ( logsLevel >= 1 )
            console.error('WS :: Invalid payload', error, event)
        }
        if ( logsLevel >= 1 )
          console.log('WS :: onPayload', parsedPayload)
        // Check if it's a return
        const { uid } = parsedPayload
        if ( uid && uid in _waitingPayloadReturns ) {
          _waitingPayloadReturns[uid](parsedPayload)
          return
        }
        // Not a return but a server payload
        api.onPayload.dispatch(parsedPayload)
        // todo : move it somewhere else
        // if (parsedPayload.type === 'exit') {
        //   _allowReconnexions = false
        //   api.disconnect()
        // }
      })
      // An error occurred on the socket
      _webSocket.addEventListener('error', (event) => {
        if ( logsLevel >= 1)
          console.error('WS :: error', event)
        // fixme : shall we disconnect here ?
        api.disconnect()
      })
      // The connexion has been lost
      _webSocket.addEventListener('close', (event) => {
        if ( logsLevel >= 1 )
          console.log('WS :: close', event)
        // fixme : shall we disconnect here ?
        api.disconnect()
        // Reconnect in a loop
        _reconnectionTimeout = setTimeout( () => api.connect(), reconnectTimeout )
      })
      return true
    },

    // ------------------------------------------------------------------------- DISCONNECT

    disconnect () {
      // Already disconnected
      if (!_webSocket)
        return
      // Kill socket
      _webSocket.close()
      _webSocket = null
      // Dispatch state change
      if (!_isConnected)
        return
      _isConnected = false
      api.onConnectionUpdated.dispatch(_isConnected)
    },

    // ------------------------------------------------------------------------- SEND PAYLOAD

    sendPayload (app: number, type: string, data?: any) {
      // Not connected
      if (!_isConnected || !_webSocket)
        return
      // Send the payload as JSON
      const payload = { type, data, app }
      if ( logsLevel >= 1 )
        console.log('WS :: sendPayload', payload, _waitingPayloadReturns.length)
      const rawPayload = JSON.stringify(payload)
      if ( logsLevel >= 2 )
        console.log('WS ->', rawPayload)
      _webSocket.send(rawPayload)
    },

    sendPayloadWithReturn<GAnswer, GType = string>(
      app: number,
      type: GType,
      data?: any
    ): Promise<ISocketPayload<GType, GAnswer>> {
      return new Promise((resolve, reject) => {
        // Not connected
        if (!_isConnected || !_webSocket)
          return
        // Create a unique ID to identify the answer
        const uid = generateSimpleUID()
        // Send the payload as JSON
        const payload = { type, data, app, uid }
        if ( logsLevel >= 1 ) {
          console.log(
            'WS :: sendPayloadWithReturn',
            payload,
            _waitingPayloadReturns.length
          )
        }
        const rawPayload = JSON.stringify(payload)
        if ( logsLevel >= 2 )
          console.log('WS ->', rawPayload)
        _webSocket.send(rawPayload)
        // Create a timeout for the response to avoid infinitely pending promises
        const timeout = setTimeout(() => {
          if ( logsLevel >= 1 ) {
            console.error(
              `WS :: sendPayloadWithReturn // timeout app "${app}" and type "${type}"`,
              data
            )
          }
          reject()
        }, payloadTimeout)
        // Register this uid as waiting for an answer
        _waitingPayloadReturns[uid as any] = (answerData: GAnswer) => {
          clearTimeout(timeout)
          resolve(answerData as any)
        }
      })
    },
  }
  return Object.freeze(api)
}
