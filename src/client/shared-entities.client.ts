import { Emitter } from "../common/emitter.js";
import { TClientSocket } from "./socket.client.js";
import { ISocketPayload } from "../common/index.common.js";

// TODO : LOGS

type TSharedEntityTypes = (
  | '@SO' /*shared-object*/
  | '@SL' /*shared-list*/
)

export type TSharedEntityPayload = ISocketPayload<
  TSharedEntityTypes, {
    // Action
    a : (
      | 'C' /*create*/
      | 'D' /*destroy*/
      | 'A' /*add*/
      | 'M' /*mutate*/
      | 'R' /*remove*/
    )
    // key
    k : string
    // Property name
    n ?: string | number
    // Value
    v ?: any
    // Parent key
    p ?: string
  }
>

export type TClientSharedEntities = ReturnType<typeof createClientSharedEntities>

export function createClientSharedEntities ( socket:TClientSocket ) {
  let _isStarted = false
  let _isStarting = false

  // List of all shared entities
  // First map is EntitiesList by appId
  // Second map is Entity by key
  // appId -> key -> Entity
  const _sharedEntitiesByApp: Map<number, Map<string, any>> = new Map()

  // When any entity changes, for the states
  const onUpdated = Emitter<[
    number,
    string,
    'C' /*create*/ | 'D' /*destroy*/ | 'M' /*mutate*/
  ]>()

  function payloadHandler (payload: TSharedEntityPayload) {
    //const { type, app, data } = payload
    const { a: appId/* app id */, t/* type */, d /* data */ } = payload
    if (t !== '@SO' /*shared-object*/ && t !== '@SL' /*shared-list*/)
      return
    const { a /*action*/, k /*key*/, v /*value*/, n /*name*/, p /*parent*/ } = d
    // --- CREATE SHARED ENTITY
    if (a === 'C' /*create*/) {
      // Create app holder
      if (!_sharedEntitiesByApp.has(appId)) _sharedEntitiesByApp.set(appId, new Map())
      // Create entity in app
      const appEntities = _sharedEntitiesByApp.get(appId) as any
      appEntities.set(k, d.v)
      // Dispatch
      onUpdated.dispatch(appId, k, 'C' /*create*/)
      if (p) onUpdated.dispatch(appId, p, 'C' /*create*/)
    }
    // --- DESTROY SHARED ENTITY
    else if (a === 'D' /*destroy*/) {
      // Remove entity from app
      if (!_sharedEntitiesByApp.has(appId))
        return
      const appEntities = _sharedEntitiesByApp.get(appId)
      if (!appEntities)
        return
      appEntities.delete(k)
      // Dispatch
      onUpdated.dispatch(appId, k, 'D' /*destroy*/)
    }
    // --- MUTATE SHARED ENTITY
    else {
      // Target shared entity in this app
      const appEntities = _sharedEntitiesByApp.get(appId)
      if (!appEntities)
        return
      const entity = appEntities.get(k)
      if (!entity) {
        console.error(`sharedEntities // payload // invalid entity not found ${k} - ${appId}`)
        return
      }
      if (t === '@SO' /*shared-object*/) {
        if (a === 'M' /*mutate*/)
          entity[n] = v
        else if (a === 'R' /*remove*/)
          delete entity[n]
        else
          return
      } else if (t === '@SL' /*shared-list*/) {
        if (a === 'A' /*add*/)
          entity.push(v)
        else if (a === 'R' /*remove*/)
          entity.splice(n, 1)
        else
          return
      } else {
        return
      }
      // Dispatch change
      onUpdated.dispatch(appId, k, 'M' /*mutate*/)
      // console.log("->", app, k, entity)
      if (p) onUpdated.dispatch(appId, p, 'M' /*mutate*/)
    }
  }

  // Recover shared entities when disconnected
  let _connexionRecover = false
  function connexionStateChanged ( isConnected:boolean ) {
    if ( !isConnected ) {
      _connexionRecover = true
    }
    if ( _connexionRecover && isConnected ) {
      _connexionRecover = false
      socket.sendPayloadWithReturn(null, '@SE')
    }
  }

  const api = {
    onUpdated,

    get isStarting () { return _isStarting },
    get isStarted () { return _isStarted },

    getAll () {
      const output: any = {}
      for (const id of _sharedEntitiesByApp.keys()) {
        const entityForApp: any = {}
        const entities = _sharedEntitiesByApp.get(id) as any
        for (const key of entities.keys()) {
          entityForApp[key] = api.getValue(id, key, true)
        }
        output[id] = entityForApp
      }
      return output
    },

    getValue (appId: number, key: string, deep = true) {
      if (!_sharedEntitiesByApp.has(appId))
        return null
      const appEntities = _sharedEntitiesByApp.get(appId)
      if (!appEntities)
        return
      const entity = appEntities.get(key)
      if (!deep || !Array.isArray(entity))
        return entity
      // Return deep list
      return (
        entity
          // Check for every sub item if we have a shared object as value
          .map((item) => {
            // It's a shared object, try to access it
            // We may have not received it so we just remove it from the list
            if (typeof item === 'object' && typeof item.__ === 'string')
              return appEntities.get(item.__) ?? null
            // Return the raw value which is not a shared object reference
            else return item
          })
          // Remove Shared Object references that we could not resolve
          .filter((item) => item !== null)
      )
    },

    start():Promise<void> {
      return new Promise((resolve, reject) => {
        if ( !socket.isConnected || _isStarted || _isStarting )
          return reject()
        _isStarting = true
        // Listen all payloads now
        socket.onPayload.add(payloadHandler)
        socket.onConnectionUpdated.add(connexionStateChanged)
        // Tell server we need all shared entities
        socket.sendPayloadWithReturn(null, '@SE')
          .then((r) => {
            _isStarting = false
            // Server has sent all entities
            if (r.d === '@OK') {
              _isStarted = true
              resolve()
            }
            // Server has sent something else or timeout
            else {
              socket.onPayload.remove(payloadHandler)
              socket.onConnectionUpdated.remove(connexionStateChanged)
              reject()
            }
          })
          .catch(() => {
            _isStarting = false
            reject()
          })
      })
    },

    stop ():Promise<void> {
      return new Promise((resolve, reject) => {
        if ( !_isStarted || _isStarting )
          return reject()
        _sharedEntitiesByApp.clear()
        _isStarted = false
        socket.onPayload.remove(payloadHandler as any)
        socket.onConnectionUpdated.remove(connexionStateChanged)
        resolve()
      })
    },
  }

  return Object.freeze(api)
}

