import { type MockInstance, beforeEach, vi } from 'vitest'

// Mock web-llm globally since it won't work outside the browser and is very slow
vi.mock('@mlc-ai/web-llm', () => ({
	CreateMLCEngine: vi.fn().mockResolvedValue({
		chat: {
			completions: {
				create: vi.fn().mockResolvedValue({
					async *[Symbol.asyncIterator]() {
						yield { choices: [{ delta: { content: 'Mock response' } }] }
					},
				}),
			},
		},
		unload: vi.fn(),
	}),
}))

export let consoleInfo: MockInstance<(typeof console)['info']>
export let consoleLog: MockInstance<(typeof console)['log']>
export let consoleError: MockInstance<(typeof console)['error']>
export let consoleWarn: MockInstance<(typeof console)['warn']>

beforeEach(() => {
	const originalConsoleInfo = console.info
	consoleInfo = vi.spyOn(console, 'info')
	consoleInfo.mockImplementation((...args: Parameters<typeof console.info>) => {
		originalConsoleInfo(...args)
		throw new Error(
			'Console info was called. Call consoleInfo.mockImplementation(() => {}) if this is expected.',
		)
	})

	const originalConsoleLog = console.log
	consoleLog = vi.spyOn(console, 'log')
	consoleLog.mockImplementation((...args: Parameters<typeof console.log>) => {
		originalConsoleLog(...args)
		throw new Error(
			'Console log was called. Call consoleLog.mockImplementation(() => {}) if this is expected.',
		)
	})

	const originalConsoleError = console.error
	consoleError = vi.spyOn(console, 'error')
	consoleError.mockImplementation(
		(...args: Parameters<typeof console.error>) => {
			originalConsoleError(...args)
			throw new Error(
				'Console error was called. Call consoleError.mockImplementation(() => {}) if this is expected.',
			)
		},
	)

	const originalConsoleWarn = console.warn
	consoleWarn = vi.spyOn(console, 'warn')
	consoleWarn.mockImplementation((...args: Parameters<typeof console.warn>) => {
		originalConsoleWarn(...args)
		throw new Error(
			'Console warn was called. Call consoleWarn.mockImplementation(() => {}) if this is expected.',
		)
	})
})
