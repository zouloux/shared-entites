// If you have no tests, uncomment this
// console.log("No test implemented.")
// process.exit(0)

// Import your code from dist directory, tests are not built on purpose
// import { randomFunction } from "../dist/index.js"
// import { subRandomFunction } from "../dist/submodule/index.js"
// // Import small testing lib from tsp
// import { describe, it, expect, startTest } from "@reflex-stack/tsp/tests"
//
// const endTest = startTest()
//
// describe("Main module", () => {
// 	it("Should call random", () => {
// 		const rootResult = randomFunction()
// 		expect(rootResult).toBe(5)
// 	})
// })
//
// describe("Sub module", () => {
// 	it("Should call sub random", () => {
// 		const subResult = subRandomFunction()
// 		expect(subResult).toBe(60)
// 	})
// 	// Test error example
// 	// it("Should fail", () => {
// 	// 	expect(5).toBe(12)
// 	// })
// })
//
// endTest()


import { createServerSocket } from "../dist/server/socket.server.js"
import { createClientSocket } from "../dist/client/socket.client.js"
import { SharedList } from "../dist/server/shared-entities.server.js";
import { createClientSharedEntities } from "../dist/client/shared-entities.client.js";
import { WebSocket } from "ws"
import fastify from "fastify";

let handleId = 0

// Create websocket server
const port = 3003
const server = fastify({})
server.listen({ host: '0.0.0.0', port })

const serverSocket = createServerSocket({
	server,
	pingInterval: 500,
	getLobbyFromRequest (request) {
		const { url } = request
		// Trying to do a websocket request on the wrong endpoint
		if ( !url.startsWith('/ws/') )
			return null
		// Extract lobby id from url
		const key = url.split('/ws/', 2)[1] ?? ""
		// Return lobby for this key
		const lobby = serverSocket.getLobby(key)
		if ( !lobby )
			return
		return {
			...lobby,
			key,
			test: true, // fixme : test for generics
		}
	},
	createHandleFromRequest (request) {
		return {
			// Create new id
			id: handleId++,
		}
	}
})

const h = handle => ({...handle, ws: null})

// Create some lobbies
const mainLobbyKey = "1234"
const mainLobby = serverSocket.openLobby(mainLobbyKey)

const allPlayers = new SharedList()
allPlayers.key = "players"
allPlayers.attach(serverSocket, mainLobby, 0)

serverSocket.onHandleConnected.add((lobby, handle) => {
	console.log("[server] handle connected", lobby.key, handle.id)
	allPlayers.add(handle.id)
})
serverSocket.onHandleDisconnected.add((lobby, handle) => {
	console.log("[server] handle remove", lobby.key, handle.id)
	allPlayers.remove(handle.id)
})
serverSocket.onPayload.add((payload, lobby, handle) => {
	console.log("[server] payload", payload, lobby.key, handle.id)
})

for ( let i = 0; i < 10; i++ ) {
	setTimeout(() => {
		const clientSocket = createClientSocket({
			endpoint: `ws://localhost:${port}/ws/${mainLobbyKey}`,
			logLevel: i === 0 ? 2 : 0,
			webSocketClass: WebSocket,
		});

		// console.log( clientSocket );
		clientSocket.connect()

		const sharedEntities = createClientSharedEntities(clientSocket)

		if ( i === 0 ) {
			clientSocket.onConnectionUpdated.once((isConnected) => {
				if (!isConnected) return
				console.log("[client] connected")
				sharedEntities.start()
				sharedEntities.onUpdated.add((appId, key, action) => {
					console.log(
						"[client] shared entity updated",
						sharedEntities.getValue(appId, "players", true)
					)
				})
				// clientSocket.sendPayload(0, "test", { coucou: true })
			})
		}

		setTimeout(() => {
			clientSocket.disconnect()
		}, 5000)

	}, (i + 1) * 100)
}

setTimeout(() => {
	server.close()
}, 10 * 1000)
