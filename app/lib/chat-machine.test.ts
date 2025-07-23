import { test, expect, vi } from 'vitest'
import { chatMachine } from './chat-machine'
import { createActor, fromPromise, type AnyStateMachine } from 'xstate'

vi.mock('./search-engine', () => ({
	search: vi.fn(),
}))

vi.mock('./tools', () => ({
	getAvailableTools: vi.fn(),
	invokeTool: vi.fn(),
	getTool: vi.fn(),
}))

vi.mock('@mlc-ai/web-llm', () => ({
	createMLCEngine: vi.fn(),
}))

// Disposable actor utility following the pattern from the article
function createDisposableActor<Machine extends AnyStateMachine>(
	machine: Machine,
	options?: any,
) {
	const actor = createActor(machine, options)

	return {
		actor,
		[Symbol.dispose]() {
			actor.stop()
		},
	}
}

// Utility function to wait for assertions to pass
async function waitFor(
	assertion: () => void,
	{
		timeout = 200,
		interval = 10,
	}: { timeout?: number; interval?: number } = {},
) {
	const startTime = Date.now()
	let lastError: Error | undefined

	while (Date.now() - startTime < timeout) {
		try {
			assertion()
			return // Assertion passed
		} catch (error) {
			lastError = error as Error
			await new Promise((resolve) => setTimeout(resolve, interval))
		}
	}

	// Timeout reached, throw the last error
	throw lastError || new Error('Timeout waiting for assertion to pass')
}

function createDeferred<T>() {
	const deferred: {
		resolve: (value: T) => void
		reject: (error: any) => void
		promise: Promise<T>
		value?: T
		error?: any
	} = {} as any
	const promise = new Promise((resolve, reject) => {
		deferred.resolve = (value: T) => {
			deferred.value = value
			resolve(value)
		}
		deferred.reject = (error: any) => {
			deferred.error = error
			reject(error)
		}
	})
	deferred.promise = promise as Promise<T>

	return deferred
}

// Helper function to create a machine with custom actors
function createChatMachineWithActors(actors: {
	toolSearch?: any
	generation?: any
	streaming?: any
	toolCall?: any
}) {
	return chatMachine.provide({
		actors: {
			toolSearch:
				actors.toolSearch ||
				fromPromise(async () => {
					await Promise.resolve()
					return { hasTools: true, tools: ['search', 'calculator'] }
				}),
			generation:
				actors.generation ||
				fromPromise(async () => {
					await Promise.resolve()
					return {
						content: 'Generated response',
						toolCall: { name: 'search', arguments: { query: 'test' } },
					}
				}),
			streaming:
				actors.streaming ||
				fromPromise(async () => {
					await Promise.resolve()
					return {
						content: 'Hello world! This is a test response with tool call.',
						toolCall: { name: 'search', arguments: { query: 'test' } },
					}
				}),
			toolCall:
				actors.toolCall ||
				fromPromise(async ({ input }: { input: any }) => {
					await Promise.resolve()
					return { result: `Tool ${input.name} executed with result: success` }
				}),
		},
		actions: {
			startToolSearch: () => {
				// Mock action - no console.log
			},
			startGenerating: () => {
				// Mock action - no console.log
			},
			cancelToolSearch: () => {
				// Mock action - no console.log
			},
			cancelGeneration: () => {
				// Mock action - no console.log
			},
			cancelStream: () => {
				// Mock action - no console.log
			},
			callTool: () => {
				// Mock action - no console.log
			},
		},
	})
}

test('should start in idle state', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	expect(disposableActor.actor.getSnapshot().value).toBe('idle')
})

test('should transition to loadingModel when LOAD_MODEL is sent', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
	})

	expect(disposableActor.actor.getSnapshot().value).toBe('loadingModel')
	expect(disposableActor.actor.getSnapshot().context.currentModelId).toBe(
		'Llama-3.1-8B-Instruct-q4f32_1-MLC',
	)
})

test('should handle model load progress', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})

	disposableActor.actor.send({
		type: 'MODEL_LOAD_PROGRESS',
		progress: 50,
	})

	expect(disposableActor.actor.getSnapshot().context.modelLoadProgress).toBe(50)
})

test('should transition to ready on model load success', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})

	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	expect(disposableActor.actor.getSnapshot().value).toBe('ready')
})

test('should transition to loadFailed on model load failure', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})

	disposableActor.actor.send({
		type: 'MODEL_LOAD_FAILURE',
		error: 'Failed to load model',
	})

	expect(disposableActor.actor.getSnapshot().value).toBe('loadFailed')
	expect(disposableActor.actor.getSnapshot().context.lastError).toBe(
		'Failed to load model',
	)
})

test('should queue messages when in idle state', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	expect(disposableActor.actor.getSnapshot().context.messageQueue).toHaveLength(
		1,
	)
	expect(disposableActor.actor.getSnapshot().context.messageQueue[0]).toEqual(
		message,
	)
})

test('should process queued messages when transitioning to ready', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})

	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	expect(disposableActor.actor.getSnapshot().context.messages).toHaveLength(1)
	expect(disposableActor.actor.getSnapshot().context.messageQueue).toHaveLength(
		0,
	)
})

test('should transition to searchingTools when message is queued in ready state', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	expect(disposableActor.actor.getSnapshot().value).toBe('searchingTools')
})

test('should handle tool search completion and transition to generatingResponse', async () => {
	// Create deferred promises for all actors to prevent them from completing too quickly
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger tool search
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Wait for tool search to start
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe('searchingTools'),
	)

	// Resolve tool search to trigger transition to generating
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Wait for tool search to complete and transition to generating
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe(
			'generatingResponse',
		),
	)
})

test('should handle generation completion and transition to streamingResponse', async () => {
	// Create deferred promises for all actors
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Wait for generation to start
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe(
			'generatingResponse',
		),
	)

	// Resolve generation to trigger transition to streaming
	generationDeferred.resolve({ content: 'Generated response' })

	// Wait for generation to complete
	await waitFor(
		() =>
			expect(disposableActor.actor.getSnapshot().value).toBe(
				'streamingResponse',
			),
		{ timeout: 50 },
	)
})

test('should handle streaming completion with tool call and transition to waitingForToolApproval', async () => {
	// Create deferred promises for all actors
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Resolve streaming with tool call
	streamingDeferred.resolve({
		content: 'Hello world! This is a test response with tool call.',
		toolCall: { name: 'search', arguments: { query: 'test' } },
	})

	// Wait for streaming to complete
	await waitFor(
		() =>
			expect(disposableActor.actor.getSnapshot().value).toBe(
				'waitingForToolApproval',
			),
		{ timeout: 50 },
	)
})

test('should handle tool approval and transition to callingTool', async () => {
	// Create deferred promises for all actors
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Resolve streaming with tool call
	streamingDeferred.resolve({
		content: 'Hello world! This is a test response with tool call.',
		toolCall: { name: 'search', arguments: { query: 'test' } },
	})

	// Wait for streaming to complete
	await waitFor(
		() =>
			expect(disposableActor.actor.getSnapshot().value).toBe(
				'waitingForToolApproval',
			),
		{ timeout: 50 },
	)

	// Approve tool call
	disposableActor.actor.send({ type: 'APPROVE_TOOL_CALL' })

	expect(disposableActor.actor.getSnapshot().value).toBe('callingTool')
})

test('should handle tool rejection and transition back to searchingTools', async () => {
	// Create deferred promises for all actors
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Resolve streaming with tool call
	streamingDeferred.resolve({
		content: 'Hello world! This is a test response with tool call.',
		toolCall: { name: 'search', arguments: { query: 'test' } },
	})

	// Wait for streaming to complete
	await waitFor(
		() =>
			expect(disposableActor.actor.getSnapshot().value).toBe(
				'waitingForToolApproval',
			),
		{ timeout: 50 },
	)

	// Reject tool call
	disposableActor.actor.send({ type: 'REJECT_TOOL_CALL' })

	expect(disposableActor.actor.getSnapshot().value).toBe('searchingTools')
	expect(disposableActor.actor.getSnapshot().context.messages).toHaveLength(3) // user message + assistant message + rejection message
})

test('should handle interruption during tool search', async () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger tool search
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Interrupt during tool search
	disposableActor.actor.send({ type: 'INTERRUPT' })

	expect(disposableActor.actor.getSnapshot().value).toBe('ready')
})

test('should handle interruption during generation', async () => {
	// Create deferred promises for tool search and generation
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Wait for generation to start
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe(
			'generatingResponse',
		),
	)

	// Interrupt during generation
	disposableActor.actor.send({ type: 'INTERRUPT' })

	expect(disposableActor.actor.getSnapshot().value).toBe('ready')
})

test('should handle interruption during streaming', async () => {
	// Create deferred promises for tool search, generation, and streaming
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Wait for streaming to start
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe('streamingResponse'),
	)

	// Interrupt during streaming
	disposableActor.actor.send({ type: 'INTERRUPT' })

	expect(disposableActor.actor.getSnapshot().value).toBe('ready')
})

test('should handle interruption during tool approval (implicit rejection)', async () => {
	// Create deferred promises for all actors
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Resolve streaming with tool call
	streamingDeferred.resolve({
		content: 'Hello world! This is a test response with tool call.',
		toolCall: { name: 'search', arguments: { query: 'test' } },
	})

	// Wait for streaming to complete
	await waitFor(
		() =>
			expect(disposableActor.actor.getSnapshot().value).toBe(
				'waitingForToolApproval',
			),
		{ timeout: 50 },
	)

	// Interrupt during tool approval (implicit rejection)
	disposableActor.actor.send({ type: 'INTERRUPT' })

	expect(disposableActor.actor.getSnapshot().value).toBe('searchingTools')
	expect(disposableActor.actor.getSnapshot().context.messages).toHaveLength(3) // user message + assistant message + rejection message
})

test('should handle interruption during tool call (implicit rejection)', async () => {
	// Create deferred promises for all actors
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const toolCallDeferred = createDeferred<{ result: string }>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
			toolCall: fromPromise(async ({ input }: { input: any }) => {
				return toolCallDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Resolve streaming with tool call
	streamingDeferred.resolve({
		content: 'Hello world! This is a test response with tool call.',
		toolCall: { name: 'search', arguments: { query: 'test' } },
	})

	// Wait for streaming to complete
	await waitFor(
		() =>
			expect(disposableActor.actor.getSnapshot().value).toBe(
				'waitingForToolApproval',
			),
		{ timeout: 50 },
	)

	// Approve tool call
	disposableActor.actor.send({ type: 'APPROVE_TOOL_CALL' })

	// Interrupt during tool call
	disposableActor.actor.send({ type: 'INTERRUPT' })

	expect(disposableActor.actor.getSnapshot().value).toBe('searchingTools')
	expect(disposableActor.actor.getSnapshot().context.messages).toHaveLength(3) // user message + assistant message + rejection message
})

test('should handle stream error and transition to ready', async () => {
	// Create deferred promises for tool search, generation, and streaming
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model first
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue a message to trigger the flow
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Wait for streaming to start
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe('streamingResponse'),
	)

	// Send stream error
	disposableActor.actor.send({
		type: 'STREAM_ERROR',
		error: 'Stream failed',
	})

	expect(disposableActor.actor.getSnapshot().value).toBe('ready')
	expect(disposableActor.actor.getSnapshot().context.lastError).toBe(
		'Stream failed',
	)
})

test('should handle switching model mid-interaction', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	// Load first model
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'model-1',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Switch to different model
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'model-2',
	})

	expect(disposableActor.actor.getSnapshot().value).toBe('loadingModel')
	expect(disposableActor.actor.getSnapshot().context.currentModelId).toBe(
		'model-2',
	)
})

test('should handle queued messages being processed correctly', () => {
	using disposableActor = createDisposableActor(
		createChatMachineWithActors({}),
		{
			input: { initialMessages: [] },
		},
	)
	disposableActor.actor.start()

	// Queue multiple messages
	const message1 = {
		id: '1',
		role: 'user' as const,
		content: 'First message',
		timestamp: new Date(),
	}

	const message2 = {
		id: '2',
		role: 'user' as const,
		content: 'Second message',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message: message1,
	})

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message: message2,
	})

	// Load model to trigger processing
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	expect(disposableActor.actor.getSnapshot().context.messages).toHaveLength(2)
	expect(disposableActor.actor.getSnapshot().context.messageQueue).toHaveLength(
		0,
	)
	expect(disposableActor.actor.getSnapshot().context.messages[0]).toEqual(
		message1,
	)
	expect(disposableActor.actor.getSnapshot().context.messages[1]).toEqual(
		message2,
	)
})

test('should handle full happy path interaction', async () => {
	// Create deferred promises for all actors
	const toolSearchDeferred = createDeferred<{
		hasTools: boolean
		tools: string[]
	}>()
	const generationDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const streamingDeferred = createDeferred<{
		content: string
		toolCall?: any
	}>()
	const toolCallDeferred = createDeferred<{ result: string }>()

	using disposableActor = createDisposableActor(
		createChatMachineWithActors({
			toolSearch: fromPromise(async () => {
				return toolSearchDeferred.promise
			}),
			generation: fromPromise(async () => {
				return generationDeferred.promise
			}),
			streaming: fromPromise(async () => {
				return streamingDeferred.promise
			}),
			toolCall: fromPromise(async ({ input }: { input: any }) => {
				return toolCallDeferred.promise
			}),
		}),
		{ input: { initialMessages: [] } },
	)
	disposableActor.actor.start()

	// Load model
	disposableActor.actor.send({
		type: 'LOAD_MODEL',
		modelId: 'test-model',
	})
	disposableActor.actor.send({ type: 'MODEL_LOAD_SUCCESS' })

	// Queue message
	const message = {
		id: '1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: new Date(),
	}

	disposableActor.actor.send({
		type: 'QUEUE_MESSAGE',
		message,
	})

	// Resolve tool search
	toolSearchDeferred.resolve({ hasTools: true, tools: ['search'] })

	// Wait for tool search
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe(
			'generatingResponse',
		),
	)

	// Resolve generation
	generationDeferred.resolve({ content: 'Generated response' })

	// Wait for generation
	await waitFor(() =>
		expect(disposableActor.actor.getSnapshot().value).toBe('streamingResponse'),
	)

	// Resolve streaming with tool call
	streamingDeferred.resolve({
		content: 'Hello world! This is a test response with tool call.',
		toolCall: { name: 'search', arguments: { query: 'test' } },
	})

	// Wait for streaming to complete and reach waitingForToolApproval
	await waitFor(
		() =>
			expect(disposableActor.actor.getSnapshot().value).toBe(
				'waitingForToolApproval',
			),
		{ timeout: 50 },
	)

	// Approve tool call
	disposableActor.actor.send({ type: 'APPROVE_TOOL_CALL' })
	expect(disposableActor.actor.getSnapshot().value).toBe('callingTool')

	// Resolve tool call
	toolCallDeferred.resolve({
		result: 'Tool search executed with result: success',
	})

	// Wait for tool call to complete
	await waitFor(() => {
		// The tool call should complete and add the tool message
		const messages = disposableActor.actor.getSnapshot().context.messages
		expect(messages.length).toBeGreaterThanOrEqual(3) // user + assistant + tool
	})

	// Verify messages were added correctly
	const messages = disposableActor.actor.getSnapshot().context.messages
	expect(messages[0].role).toBe('user')
	expect(messages[1].role).toBe('assistant')
	expect(messages[2].role).toBe('tool')
	expect(messages[2].content).toBe('Tool search executed with result: success')
})
