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
      | 'P' /*mutate prop*/
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
  let _isSyncing = false

  // List of all shared entities
  // First map is EntitiesList by appId
  // Second map is Entity by key
  // appId -> key -> Entity
  const _sharedEntitiesByApp: Map<number, Map<string, any>> = new Map()

  // When any entity changes, for the states
  const onUpdated = Emitter<[
    number,
    string,
    'C' /*create*/ | 'D' /*destroy*/ | 'M' /*mutate*/ | 'P' /*mutate-prop*/
  ]>()

  const onSynced = Emitter<[boolean]>()

  function payloadHandler (payload: TSharedEntityPayload) {
    //const { type, app, data } = payload
    const { a: appId/* app id */, t/* type */, d /* data */ } = payload
    if (t !== '@SO' /*shared-object*/ && t !== '@SL' /*shared-list*/)
      return
    const { a /*action*/, k /*key*/, v /*value*/, n /*name*/, p /*parent*/ } = d
    // --- CREATE SHARED ENTITY
    if (a === 'C' /*create*/) {
			// Check value
			if (!d || d.v === null || d.v === undefined) {
        console.error(`sharedEntities // payload // invalid data value not found ${d?.v} - ${appId}`)
				return
			}
      // Create app holder
      if (!_sharedEntitiesByApp.has(appId))
				_sharedEntitiesByApp.set(appId, new Map())
      // Create entity in app
      const appEntities = _sharedEntitiesByApp.get(appId) as any
      appEntities.set(k, d.v)
      // Dispatch
      onUpdated.dispatch(appId, k, 'C' /*create*/)
      if (p)
				onUpdated.dispatch(appId, p, 'C' /*create*/)
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
      // fixme : sometimes we have updates while syncing shared entities
      //          server should check if in sync with client to send updates
      if (!entity) {
        console.error(`sharedEntities // payload // invalid entity not found ${k} - ${appId}`)
        return
      }
      // Always recreate entity references
      // We do this for better handling in react, with a performance tradeoff
      // FIXME : For better perfs, we should mutate and recreate ref + dispatch only after a microtask
      let clone
      if (t === '@SO' /*shared-object*/) {
        clone = {...entity}
        if (a === 'M' /*mutate*/)
          clone[n] = v
        else if (a === 'R' /*remove*/)
          delete clone[n]
        // Invalid action, no mutation
        else return
      }
      else if (t === '@SL' /*shared-list*/) {
        clone = [...entity]
        if (a === 'A' /*add*/)
          clone.push(v)
        else if (a === 'R' /*remove*/)
          clone.splice(n, 1)
        else if (a === 'M' /*mutate*/)
          clone[n] = v
        else if (a === 'P' /*mutate prop*/) {
          // Also clone sub object
          const subClone = { ...clone[n] }
          // Set new value on prop
          subClone[p] = v
          // Assign back the new reference
          clone[n] = subClone
        }
        // Invalid action, no mutation
        else return
      }
      // Invalid type, no mutation
      else return
      // Set back the new entity reference to the map
      appEntities.set(k, clone)
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
      onSynced.dispatch(false)
    }
    else if ( _connexionRecover && isConnected && !_isSyncing ) {
      _isSyncing = true
      _connexionRecover = false
      _sharedEntitiesByApp.clear()
      socket.sendPayloadWithReturn(null, '@SE')
        .then(() => {
          onSynced.dispatch(true)
          _isSyncing = false
        })
        .catch(() => {
          _isSyncing = false
          console.error('sharedEntities // unable to recover shared entities')
          // todo : try to get back all
        })
    }
  }

  const api = {
    onSynced,
    onUpdated,

    get isSyncing () { return _isSyncing },
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
            else
							return item
          })
          // Remove Shared Object references that we could not resolve
          .filter((item) => item !== null && item !== undefined)
      )
    },

    start():Promise<void> {
      return new Promise((resolve, reject) => {
        if ( !socket.isConnected || _isStarted || _isSyncing )
          return reject()
        _isSyncing = true
        // Listen all payloads now
        socket.onPayload.add(payloadHandler)
        socket.onConnectionUpdated.add(connexionStateChanged)
        // Tell server we need all shared entities
        socket.sendPayloadWithReturn<string>(null, '@SE')
          .then((r) => {
            _isSyncing = false
            // Server has sent all entities
            if (r === '@OK') {
              _isStarted = true
              onSynced.dispatch(true)
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
            _isSyncing = false
            reject()
          })
      })
    },

    stop ():Promise<void> {
      return new Promise((resolve, reject) => {
        if ( !_isStarted || _isSyncing )
          return reject()
        _sharedEntitiesByApp.clear()
        _isStarted = false
        onSynced.dispatch(false)
        socket.onPayload.remove(payloadHandler as any)
        socket.onConnectionUpdated.remove(connexionStateChanged)
        resolve()
      })
    },
  }

  return Object.freeze(api)
}

