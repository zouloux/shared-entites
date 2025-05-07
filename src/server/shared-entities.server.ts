import { createUniqueID, ISocketPayload } from "../common/index.common.js";
import { TServerSocket, TServerSocketHandle, TServerSocketLobby } from "./socket.server.js";

// ----------------------------------------------------------------------------- TYPES

type TValueOrMutator <GType, GKey extends keyof GType, GValue = GType[GKey]> = (
  GValue | (
   (value:GValue) => GValue
  )
)

export type TSharedEntityPayload = ISocketPayload<
  "@SO"/*shared-object*/|"@SL"/*shared-list*/, {
    // Action
    a  :"C"/*create*/ | "D"/*destroy*/ | "A"/*add*/ | "M"/*mutate*/ | "R"/*remove*/
    // key
    k  :string
    // Property name
    n  ?:string|number
    // Value
    v  ?:any
    // Parent key
    p  ?:string
  }
>

export type TSharedEntityTypes = 'list' | 'object' | 'abstract'

// ----------------------------------------------------------------------------- SHARED ENTITY

export abstract class AbstractSharedEntity <GType = any> {

  readonly type:TSharedEntityTypes = 'abstract'

  protected _value:GType

  public serverSocket :TServerSocket
  public lobby        :TServerSocketLobby
  public appId        :number
  public key          :string
  public parentKey    :string

  attach ( serverSocket:TServerSocket, lobby:TServerSocketLobby, appId:number, parentKey?:string ) {
    this.serverSocket = serverSocket
    this.lobby = lobby
    this.appId = appId
    this.parentKey = parentKey
    lobby.sharedEntities.push( this )
    this.onAttached()
  }

  unserialize ( value:any ) {
    return value
  }
  serialize ( value:any ) {
    return value
  }

  protected abstract onAttached ()

  abstract sendToHandle ( handle?:TServerSocketHandle )

  dispose () {
    if ( this.lobby && this.lobby.sharedEntities )
      this.lobby.sharedEntities = this.lobby.sharedEntities.filter( e => e !== this )
    this.serverSocket = null
    this.parentKey = null
    this.lobby = null
    this.key = null
    this._value = null
  }
}


// ----------------------------------------------------------------------------- SHARED OBJECT

export class SharedObject <GType extends object> extends AbstractSharedEntity <GType> {

  protected static identifier = "@SO"/*shared-object*/

  readonly type:TSharedEntityTypes = 'object'

  declare protected _value:GType
  get value ():GType { return this._value }

  constructor ( from?:GType ) {
    super()
    this._value = { ...from }
  }

  // --------------------------------------------------------------------------- SYNC

  protected onAttached () {
    this.sendToHandle()
  }

  sendToHandle ( handle?:TServerSocketHandle ) {
    if ( !this.serverSocket || !this.lobby )
      return
    const payloadData:TSharedEntityPayload['d'] = {
      a: "C"/*create*/,
      k: this.key,
      v: this._value,
    }
    if ( this.parentKey )
      payloadData.p = this.parentKey
    const handles:TServerSocketHandle[] = handle ? [handle] : this.lobby.handles
    this.serverSocket.sendPayload(handles, this.appId, SharedObject.identifier, payloadData)
  }

  dispose () {
    if ( this.serverSocket && this.lobby ) {
      this.serverSocket.sendPayload(this.lobby.handles, this.appId, SharedObject.identifier, {
        a: "D"/*destroy*/,
        k: this.key,
      })
    }
    super.dispose()
  }

  // --------------------------------------------------------------------------- OBJECT METHODS

  mutate <GKey extends keyof GType> ( propName:GKey, value:TValueOrMutator<GType, GKey> ):GType[GKey] {
    // Resolve value if we have a mutator function
    value = (
      typeof value === "function"
      ? (value as Function)( this._value[ propName ] )
      : value
    ) as GType[GKey]
    // Generate payload data to send
    const payloadData:TSharedEntityPayload['d'] = {
      k: this.key,
      v: value,
      p: this.parentKey,
      // @ts-ignore
      n: propName,
    }
    // Delete prop if value is undefined - only if it exists
    if ( value === undefined && propName in this._value ) {
      delete this._value[ propName ]
      if ( this.serverSocket && this.lobby ) {
        this.serverSocket.sendPayload(this.lobby.handles, this.appId, SharedObject.identifier, {
          ...payloadData,
          a: "R"/*remove*/,
        })
      }
    }
    // Mutate value - only if different
    else if ( value !== this._value[ propName ] ) {
      this._value[ propName ] = value
      if ( this.serverSocket && this.lobby ) {
        this.serverSocket.sendPayload(this.lobby.handles, this.appId, SharedObject.identifier, {
          ...payloadData,
          a: "M"/*mutate*/,
        })
      }
    }
    return value
  }

  merge <GKey extends keyof GType> ( from:Partial<GType> ) {
    Object.keys( from ).forEach( fromKey => {
      const value = from[fromKey]
      if ( typeof value !== "undefined" )
        this.mutate( fromKey as GKey, value )
    })
  }

  clear () {
    Object.keys( this._value ).forEach( key => {
      this.mutate( key as keyof GType, undefined )
    })
  }

  removeProps <GKey extends keyof GType> ( props:GKey[] ) {
    props.map( prop => {
      this.mutate( prop, undefined )
    })
  }
}

// ----------------------------------------------------------------------------- SHARED LIST

export class SharedList <GType> extends AbstractSharedEntity <GType[]> {

  protected static identifier = "@SL"/*shared-list*/

  declare protected _value:GType[]
  get value ():GType[] { return this._value }

  get size ():number { return this._value.length }

  getOne ( index:number ):GType { return this._value[index] }
  getAll ():GType[] { return this._value }

  readonly type:TSharedEntityTypes = 'list'

  constructor ( items?:GType[] ) {
    super()
    this._value = items ?? []
  }

  protected onAttached () {
    this._value.forEach( item => this.processItem("A", item) )
    this.sendToHandle()
  }

  // --------------------------------------------------------------------------- SYNC

  protected serializeItem ( item:GType ):GType|{ __:string } {
    if ( item instanceof AbstractSharedEntity )
      return { __: item.key }
    else
      return item
  }

  sendToHandle ( handle?:TServerSocketHandle ) {
    if ( !this.serverSocket || !this.lobby )
      return
    const payloadData:TSharedEntityPayload["d"] = {
      a: "C"/*create*/,
      k: this.key,
      v: this._value.map( item => this.serializeItem( item ) ),
    }
    const handles:TServerSocketHandle[] = handle ? [handle] : this.lobby.handles
    this.serverSocket.sendPayload(handles, this.appId, SharedList.identifier, payloadData)
  }

  dispose () {
    this.clear()
    this.serverSocket.sendPayload(this.lobby.handles, this.appId, SharedList.identifier, {
      a: "D"/*destroy*/,
      k: this.key,
    })
    super.dispose()
  }

  protected processItem ( action:"A"|"R", item:GType ) {
    const payloadData:TSharedEntityPayload['d'] = {
      a: action,
      k: this.key,
    }
    if ( item instanceof SharedObject ) {
      // We add a shared-object into a shared list
      if ( action === "A"/*add*/ ) {
        // Create a unique id and connect to the party
        item.key ??= '@' + createUniqueID(8)
        item.attach( this.serverSocket, this.lobby, this.appId, this.key )
      }
      else if ( action === "R"/*remove*/ )
        item.dispose()
    }
    if ( action === "A"/*add*/ )
      payloadData.v = this.serializeItem( item )
    else if ( action === "R"/*remove*/ )
      payloadData.n = this._value.indexOf( item )
    this.serverSocket.sendPayload(this.lobby.handles, this.appId, SharedList.identifier, payloadData )
  }

  // --------------------------------------------------------------------------- LIST METHODS

  add ( item:GType ) {
    this._value.push( item )
    this.processItem("A"/*add*/, item)
  }

  addAll ( items:GType[] ) {
    items.forEach( item => this.add( item ) )
  }

  remove ( item:GType ) {
    this.processItem( "R"/*remove*/, item )
    this._value = this._value.filter( i => i !== item )
  }

  clear () {
    this._value.forEach( item => {
      this.processItem( "R"/*remove*/, item )
    })
    this._value = []
  }

  // --------------------------------------------------------------------------- SERIALIZE

  unserialize ( value:any[]) {
    return value.map( item => {
      if ( typeof item === 'object' && typeof item['__'] === 'string' ) {
        const object = new SharedObject()
        object.key = item['__']
        object.attach( this.serverSocket, this.lobby, this.appId, this.key )
        return object
      }
      return item
    })
  }

  serialize ( value:any[]) {
    return value.map( item => {
      if ( item instanceof SharedObject )
        return { __: item.key }
      return item
    })
  }
}
