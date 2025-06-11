import { generateSimpleUID } from '../common/random.js'
import { Emitter } from "../common/emitter.js";
import { ISocketPayload } from "../common/index.common.js";


export interface TOptions {
  endpoint          : string
  logLevel          ?:TLogLevel
  reconnectTimeout  ?:number
  payloadTimeout    ?:number
  webSocketClass    ?:any
}

export type TLogLevel = 0 | 1 | 2

export type TClientSocket = ReturnType<typeof createClientSocket>

export function createClientSocket (options:TOptions) {
  // Extract options
  let { endpoint, reconnectTimeout, payloadTimeout, logLevel, webSocketClass } = options
  // Check endpoint
  if ( !endpoint.startsWith("ws://") && !endpoint.startsWith("wss://") ) {
    throw new Error('Invalid endpoint scheme')
  }
  // Log level
  logLevel ||= 0
  // Socket state
  let _webSocket: WebSocket | null
  let _isConnected = false
  // Reconnection management
  reconnectTimeout ||= 1000
  let _reconnectionTimeout: any
  let _allowReconnexions = false
  // Waiting payload returns
  payloadTimeout ||= 10 * 1000 // 10 seconds
  const _waitingPayloadReturns = new Map<string, (payload:ISocketPayload) => void>()

  // --------------------------------------------------------------------------- PUBLIC API
  const api = {
    /**
     * Set log level.
     * 0: No logs
     * 1: Payload logs
     * 2: Verbose with raw logs
     * @param level
     */
    set logLevel (level:TLogLevel) {
      if ( level < 0 || level > 2 )
        throw new Error('Invalid log level')
      logLevel = level
    },
    get logLevel ():TLogLevel { return logLevel },

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

    async connect ():Promise<void> {
      return new Promise((resolve, reject) => {
        // Already connected or exited
        if (_isConnected)
          return reject()
        let _hasPromised = false
        // Remove reconnect timeout
        clearTimeout(_reconnectionTimeout)
        _reconnectionTimeout = null
        // Compute socket endpoint from protocol and party code
        _webSocket = webSocketClass ? new webSocketClass(endpoint) : new WebSocket(endpoint)
        // We are connected
        _webSocket.addEventListener('open', () => {
          if ( _hasPromised )
            return
          if ( logLevel >= 1 )
            console.log('WS :: open')
          _allowReconnexions = true
          _hasPromised = true
          _isConnected = true
          api.onConnectionUpdated.dispatch(_isConnected)
          resolve()
        })
        // We receive a payload from server
        _webSocket.addEventListener('message', (event) => {
          if ( !_hasPromised )
            return
          if (typeof event.type !== 'string') {
            if ( logLevel >= 1 )
              console.error('WS :: Invalid message type', event)
            return
          }
          // This is a ping
          if (event.data.startsWith('@PING')) {
            if ( logLevel >= 2 )
              console.log(`WS :: ${event.data}`)
            return
          }
          // Parse it as json
          let parsedPayload
          try {
            parsedPayload = JSON.parse(event.data)
          } catch (error) {
            if ( logLevel >= 1 )
              console.error('WS :: Invalid payload', error, event)
          }
          const { a, t, u } = parsedPayload
          if ( logLevel === 1 )
            console.log('WS :: onPayload', a, t)
          if ( logLevel >= 2 )
            console.log('WS <-', event.data)
          // Close connection from server
          if ( parsedPayload.t === '@CLOSE' ) {
            api.disconnect()
            return
          }
          // Check if it's a return
          if ( u && _waitingPayloadReturns.has(u) ) {
            _waitingPayloadReturns.get(u)(parsedPayload.d)
            return
          }
          // Not a return but a server payload
          api.onPayload.dispatch(parsedPayload)
        })
        // An error occurred on the socket
        _webSocket.addEventListener('error', (event) => {
          if ( logLevel >= 1 )
            console.error('WS :: error', event)
          // fixme : do we keep this ?
          // if ( !_hasPromised )
          //   return reject()
        })
        // The connexion has been lost
        _webSocket.addEventListener('close', (event) => {
          if ( logLevel >= 1 )
            console.log('WS :: close')
          // if ( logLevel >= 2 )
          //   console.log( event );
          let oldIsConnected = _isConnected;
          _isConnected = false
          if ( !_hasPromised ) {
            _hasPromised = true
            reject()
          }
          // Reconnect in a loop
          if ( _allowReconnexions && reconnectTimeout > 0 ) {
            _reconnectionTimeout = setTimeout( () => {
              if ( _allowReconnexions )
                api.connect().catch( () => {} );
            }, reconnectTimeout )
          }
          // Signal connexion state
          else if ( oldIsConnected !== _isConnected ) {
            _allowReconnexions = false
            _webSocket.close()
            _webSocket = null
            api.onConnectionUpdated.dispatch(_isConnected)
          }
        })
      })
    },

    // ------------------------------------------------------------------------- DISCONNECT

    disconnect () {
      // Already disconnected
      if (!_webSocket)
        return
      _allowReconnexions = false
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

    sendPayload (a:number /* app id */, t:string /* type */, d:any /* data */ = null) {
      // Not connected
      if (!_isConnected || !_webSocket)
        return
      // Send the payload as JSON
      const payload:ISocketPayload = { a, t, d }
      if ( logLevel >= 1 )
        console.log('WS :: sendPayload', a, t)
      const rawPayload = JSON.stringify(payload)
      if ( logLevel >= 2 )
        console.log('WS ->', rawPayload)
      _webSocket.send(rawPayload)
    },

    sendPayloadWithReturn<GAnswer, GType extends string = string>(
      a: number /* app id */,
      t: GType /* type */,
      d:any /* data */ = null
    ): Promise<ISocketPayload<GType, GAnswer>> {
      return new Promise((resolve, reject) => {
        // Not connected
        if (!_isConnected || !_webSocket) {
          reject()
          return
        }
        // Create a unique ID to identify the answer
        const u = generateSimpleUID()
        // Send the payload as JSON
        const payload:ISocketPayload = { a, t, d, u }
        if ( logLevel === 1 ) {
          console.log(
            'WS :: sendPayloadWithReturn',
            a, t, u,
            _waitingPayloadReturns.size
          )
        }
        const rawPayload = JSON.stringify(payload)
        if ( logLevel >= 2 )
          console.log('WS ->', rawPayload)
        _webSocket.send(rawPayload)
        // Create a timeout for the response to avoid infinitely pending promises
        const timeout = setTimeout(() => {
          if ( logLevel >= 1 )
            console.error('WS :: timeout', a, t, d)
          reject()
        }, payloadTimeout)
        // Register this uid as waiting for an answer
        _waitingPayloadReturns.set(u, (answerData: GAnswer) => {
          clearTimeout(timeout)
          resolve(answerData as any)
        })
      })
    },
  }
  return Object.freeze(api)
}
