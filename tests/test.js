// If you have no tests, uncomment this
// console.log("No test implemented.")
// process.exit(0)

// Import your code from dist directory, tests are not built on purpose
import { randomFunction } from "../dist/index.js"
import { subRandomFunction } from "../dist/submodule/index.js"
// Import small testing lib from tsp
import { describe, it, expect, startTest } from "@reflex-stack/tsp/tests"

const endTest = startTest()

describe("Main module", () => {
	it("Should call random", () => {
		const rootResult = randomFunction()
		expect(rootResult).toBe(5)
	})
})

describe("Sub module", () => {
	it("Should call sub random", () => {
		const subResult = subRandomFunction()
		expect(subResult).toBe(60)
	})
	// Test error example
	// it("Should fail", () => {
	// 	expect(5).toBe(12)
	// })
})

endTest()
