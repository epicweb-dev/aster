import { setup, assign, fromPromise, fromCallback } from 'xstate'
import type {
	MLCEngineConfig,
	ChatOptions,
	MLCEngineInterface,
	ChatCompletionMessage,
	ChatCompletionChunk,
	ChatCompletionMessageParam,
} from '@mlc-ai/web-llm'

// Types for the state machine
type WebLLMContext = {
	engine: MLCEngineInterface | null
	modelId: string | null
	isModelLoaded: boolean
	loadingProgress: number
	error: string | null
	currentChatId: string | null
	chatHistory: ChatCompletionMessage[]
	streamedContent: string
	isStreaming: boolean
	usage: {
		promptTokens: number
		completionTokens: number
		totalTokens: number
	} | null
}

type WebLLMEvents =
	| {
			type: 'LOAD_MODEL'
			modelId: string
			engineConfig?: MLCEngineConfig
			chatOpts?: ChatOptions
	  }
	| { type: 'MODEL_LOADED' }
	| { type: 'LOADING_PROGRESS'; progress: number }
	| { type: 'LOAD_ERROR'; error: string }
	| {
			type: 'START_CHAT'
			messages: Array<ChatCompletionMessageParam>
			options?: ChatCompletionOptions
	  }
	| {
			type: 'CHAT_COMPLETION_RECEIVED'
			content: string
			isComplete: boolean
			usage?: any
	  }
	| { type: 'STREAM_CHUNK'; chunk: ChatCompletionChunk }
	| { type: 'CHAT_ERROR'; error: string }
	| { type: 'CLEAR_CHAT' }
	| { type: 'TEARDOWN' }
	| { type: 'RESET' }

type ChatCompletionOptions = {
	temperature?: number
	maxTokens?: number
	stream?: boolean
	seed?: number
	jsonMode?: boolean
	tools?: any[]
	toolChoice?: any
}

// Actor implementations
const createEngineActor = fromPromise(
	async ({
		input,
	}: {
		input: {
			modelId: string
			engineConfig?: MLCEngineConfig
			chatOpts?: ChatOptions | Array<ChatOptions>
		}
	}) => {
		const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

		const engine = await CreateMLCEngine(
			input.modelId,
			input.engineConfig,
			input.chatOpts,
		)

		return engine
	},
)

const chatCompletionActor = fromCallback(
	({
		sendBack,
		input,
	}: {
		sendBack: any
		input: {
			engine: MLCEngineInterface
			messages: Array<ChatCompletionMessageParam>
			options: ChatCompletionOptions
		}
	}) => {
		const { engine, messages, options } = input

		const performChat = async () => {
			try {
				if (options.stream) {
					// Handle streaming
					const chunks = await engine.chat.completions.create({
						messages,
						...options,
						stream: true,
						stream_options: { include_usage: true },
					})

					let fullContent = ''
					for await (const chunk of chunks) {
						const content = chunk.choices[0]?.delta.content || ''
						fullContent += content

						sendBack({
							type: 'STREAM_CHUNK',
							chunk,
							content,
							isComplete: false,
						})
					}

					// Get final message
					const finalMessage = await engine.getMessage()

					sendBack({
						type: 'CHAT_COMPLETION_RECEIVED',
						content: finalMessage,
						isComplete: true,
						usage: null, // Usage is included in the last chunk
					})
				} else {
					// Handle non-streaming
					const reply = (await engine.chat.completions.create({
						messages,
						...options,
					})) as any

					sendBack({
						type: 'CHAT_COMPLETION_RECEIVED',
						content: reply.choices[0].message.content || '',
						isComplete: true,
						usage: reply.usage,
					})
				}
			} catch (error) {
				sendBack({
					type: 'CHAT_ERROR',
					error:
						error instanceof Error ? error.message : 'Unknown error occurred',
				})
			}
		}

		performChat()

		return () => {
			// Cleanup function
		}
	},
)

// Create the state machine
export const webLLMMachine = setup({
	types: {
		context: {} as WebLLMContext,
		events: {} as WebLLMEvents,
		input: {} as {},
	},
	actors: {
		createEngine: createEngineActor,
		chatCompletion: chatCompletionActor,
	},
	actions: {
		assignEngine: assign({
			engine: ({ event }) => (event as any).output,
			isModelLoaded: true,
			error: null,
		}),
		assignLoadingProgress: assign({
			loadingProgress: ({ event }) => (event as any).progress,
		}),
		assignError: assign({
			error: ({ event }) => (event as any).error,
			isModelLoaded: false,
		}),
		assignChatId: assign({
			currentChatId: () => crypto.randomUUID(),
		}),
		assignMessages: assign({
			chatHistory: ({ event }) => (event as any).messages,
			streamedContent: '',
			isStreaming: false,
			usage: null,
		}),
		assignStreamChunk: assign({
			streamedContent: ({ context, event }) =>
				context.streamedContent + (event as any).content,
			isStreaming: true,
		}),
		assignChatCompletion: assign({
			streamedContent: ({ event }) => (event as any).content,
			isStreaming: false,
			usage: ({ event }) => (event as any).usage || null,
		}),
		assignChatError: assign({
			error: ({ event }) => (event as any).error,
			isStreaming: false,
		}),
		clearChat: assign({
			chatHistory: [],
			streamedContent: '',
			isStreaming: false,
			usage: null,
			currentChatId: null,
		}),
		reset: assign({
			engine: null,
			modelId: null,
			isModelLoaded: false,
			loadingProgress: 0,
			error: null,
			currentChatId: null,
			chatHistory: [],
			streamedContent: '',
			isStreaming: false,
			usage: null,
		}),
	},
	guards: {
		isModelLoaded: ({ context }) =>
			context.isModelLoaded && context.engine !== null,
		isNotStreaming: ({ context }) => !context.isStreaming,
	},
}).createMachine({
	id: 'webLLM',
	initial: 'idle',
	context: {
		engine: null,
		modelId: null,
		isModelLoaded: false,
		loadingProgress: 0,
		error: null,
		currentChatId: null,
		chatHistory: [],
		streamedContent: '',
		isStreaming: false,
		usage: null,
	},
	states: {
		idle: {
			on: {
				LOAD_MODEL: {
					target: 'loading',
					actions: assign({
						modelId: ({ event }) => event.modelId,
						loadingProgress: 0,
						error: null,
					}),
				},
			},
		},
		loading: {
			invoke: {
				src: 'createEngine',
				input: ({ context, event }) => ({
					modelId: (event as any).modelId,
					engineConfig: (event as any).engineConfig,
					chatOpts: (event as any).chatOpts,
				}),
				onDone: {
					target: 'ready',
					actions: [
						'assignEngine',
						({ self }) => {
							// Send MODEL_LOADED event to parent
							self._parent?.send({ type: 'MODEL_LOADED', ref: self })
						},
					],
				},
				onError: {
					target: 'error',
					actions: assign({
						error: ({ event }) =>
							(event as any).error?.message || 'Failed to load model',
					}),
				},
			},
			on: {
				LOADING_PROGRESS: {
					actions: 'assignLoadingProgress',
				},
				LOAD_ERROR: {
					target: 'error',
					actions: 'assignError',
				},
			},
		},
		ready: {
			on: {
				START_CHAT: {
					target: 'chatting',
					guard: 'isNotStreaming',
					actions: ['assignChatId', 'assignMessages'],
				},
				LOAD_MODEL: {
					target: 'loading',
					actions: assign({
						modelId: ({ event }) => event.modelId,
						loadingProgress: 0,
						error: null,
					}),
				},
				TEARDOWN: {
					target: 'tearingDown',
				},
				RESET: {
					target: 'idle',
					actions: 'reset',
				},
			},
		},
		chatting: {
			invoke: {
				src: 'chatCompletion',
				input: ({ context, event }) => ({
					engine: context.engine!,
					messages: (event as any).messages,
					options: {
						temperature: 0.7,
						maxTokens: 1000,
						stream: true,
						...(event as any).options,
					},
				}),
				onDone: {
					target: 'ready',
				},
				onError: {
					target: 'error',
					actions: 'assignChatError',
				},
			},
			on: {
				STREAM_CHUNK: {
					actions: 'assignStreamChunk',
				},
				CHAT_COMPLETION_RECEIVED: {
					target: 'ready',
					actions: 'assignChatCompletion',
				},
				CHAT_ERROR: {
					target: 'ready',
					actions: 'assignChatError',
				},
				CLEAR_CHAT: {
					actions: 'clearChat',
				},
			},
		},
		error: {
			on: {
				LOAD_MODEL: {
					target: 'loading',
					actions: assign({
						modelId: ({ event }) => event.modelId,
						loadingProgress: 0,
						error: null,
					}),
				},
				RESET: {
					target: 'idle',
					actions: 'reset',
				},
			},
		},
		tearingDown: {
			entry: assign({
				engine: null,
				isModelLoaded: false,
			}),
			always: {
				target: 'idle',
			},
		},
	},
})

// Helper function to create a WebLLM actor
export const createWebLLMActor = (modelId?: string) => {
	const actor = webLLMMachine.provide({
		actors: {
			createEngine: fromPromise(
				async ({
					input,
				}: {
					input: { modelId: string; engineConfig?: any; chatOpts?: any }
				}) => {
					const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

					const engine = await CreateMLCEngine(
						input.modelId,
						input.engineConfig,
						input.chatOpts,
					)

					return engine
				},
			),
		},
	})

	return actor
}

// Export types for external use
export type { WebLLMContext, WebLLMEvents, ChatCompletionOptions }
