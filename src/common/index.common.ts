
/**
 * Represents a socket payload from client to server or server to client.
 */
export interface ISocketPayload <GType extends string = string, GData = any> {
	/* app id */
  a ?: number
	/* type */
  t ?: GType
	/* uid ( for answers ) */
  u ?: string
	/* data */
  d ?: GData
}

// export type * from "./types.js"
export * from "./random.js"
export * from "./emitter.js"
