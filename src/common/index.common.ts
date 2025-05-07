/**
 * Represents a socket payload from client to server or server to client.
 */
export interface ISocketPayload <GType = string, GData = any> {
	// app id
  a ?: number
	// payload type
  t ?: GType
	// payload uid
  u ?: string
	// payload data
  d ?: GData
}

export * from "./random.js"
export * from "./emitter.js"
