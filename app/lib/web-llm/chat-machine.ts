import { setup, assign, fromPromise, fromCallback } from 'xstate'
import type {
	MLCEngineConfig,
	ChatOptions,
	MLCEngineInterface,
	ChatCompletionMessage,
	ChatCompletionChunk,
	ChatCompletionMessageParam,
} from '@mlc-ai/web-llm'

// Types
type Message = {
	id: string
	role: 'user' | 'assistant' | 'system'
	content: string
	timestamp: Date
}

type ChatContext = {
	// UI State
	messages: Message[]
	inputValue: string
	isLoading: boolean
	isStreaming: boolean
	streamedContent: string
	error: string | null

	// LLM State
	engine: MLCEngineInterface | null
	modelId: string | null
	isModelLoaded: boolean
	modelLoadingProgress: number
	currentChatId: string | null
	usage: {
		promptTokens: number
		completionTokens: number
		totalTokens: number
	} | null
}

type ChatEvents =
	| { type: 'SET_INPUT'; value: string }
	| { type: 'SEND_MESSAGE' }
	| { type: 'CLEAR_CHAT' }
	| {
			type: 'LOAD_MODEL'
			modelId: string
			engineConfig?: MLCEngineConfig
			chatOpts?: ChatOptions
	  }
	| { type: 'MODEL_LOADING_PROGRESS'; progress: { progress: number } }
	| { type: 'STREAM_UPDATE'; content: string }
	| { type: 'RECEIVE_MESSAGE'; content: string }
	| { type: 'ERROR'; error: string }
	| { type: 'STREAM_CHUNK'; content: string; chunk: any }
	| {
			type: 'CHAT_COMPLETION_RECEIVED'
			content: string
			isComplete: boolean
			usage?: any
	  }
	| { type: 'CHAT_ERROR'; error: string }

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

// Create the merged state machine
export const chatMachine = setup({
	types: {
		context: {} as ChatContext,
		events: {} as ChatEvents,
	},
	actors: {
		createEngine: createEngineActor,
		chatCompletion: chatCompletionActor,
	},
	actions: {
		logTransition: ({ event, context }) => {
			console.log(`[ChatMachine] Transition:`, {
				event: event.type,
				context: {
					messagesCount: context.messages.length,
					isLoading: context.isLoading,
					isStreaming: context.isStreaming,
					isModelLoaded: context.isModelLoaded,
					modelLoadingProgress: context.modelLoadingProgress,
					error: context.error,
				},
			})
		},
		assignInput: assign({
			inputValue: ({ event }) =>
				event.type === 'SET_INPUT' ? event.value : '',
		}),
		assignError: assign({
			error: ({ event }) => (event.type === 'ERROR' ? event.error : null),
			isLoading: false,
			isStreaming: false,
			modelLoadingProgress: 0,
		}),
		clearChat: assign({
			messages: [],
			inputValue: '',
			isLoading: false,
			isStreaming: false,
			streamedContent: '',
			error: null,
			modelLoadingProgress: 0,
			currentChatId: null,
			usage: null,
		}),
		assignEngine: assign({
			engine: ({ event }) => (event as any).output,
			isModelLoaded: true,
			error: null,
			modelLoadingProgress: 0,
		}),
		assignModelLoadingProgress: assign({
			modelLoadingProgress: ({ event }) => {
				const progress =
					event.type === 'MODEL_LOADING_PROGRESS'
						? Math.round(event.progress.progress * 100)
						: 0
				console.log(
					`[ChatMachine] Updated model loading progress:`,
					progress,
					'%',
				)
				return progress
			},
		}),
		assignStreaming: assign({
			isStreaming: true,
			isLoading: false,
			error: null,
		}),
		assignStreamUpdate: assign({
			streamedContent: ({ event }) =>
				event.type === 'STREAM_UPDATE' ? event.content : '',
			isStreaming: true,
		}),
		assignReceiveMessage: assign({
			messages: ({ context, event }) => {
				if (event.type !== 'RECEIVE_MESSAGE') return context.messages
				return [
					...context.messages,
					{
						id: crypto.randomUUID(),
						role: 'assistant',
						content: event.content,
						timestamp: new Date(),
					} as Message,
				]
			},
			streamedContent: '',
			isStreaming: false,
			isLoading: false,
			usage: ({ event }) => (event as any).usage || null,
		}),
		assignUserMessage: assign({
			messages: ({ context }) => [
				...context.messages,
				{
					id: crypto.randomUUID(),
					role: 'user',
					content: context.inputValue,
					timestamp: new Date(),
				} as Message,
			],
			inputValue: '',
			isLoading: true,
			error: null,
			currentChatId: () => crypto.randomUUID(),
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
			isLoading: false,
		}),
		reset: assign({
			engine: null,
			modelId: null,
			isModelLoaded: false,
			modelLoadingProgress: 0,
			error: null,
			currentChatId: null,
			usage: null,
		}),
	},
	guards: {
		isModelLoaded: ({ context }) =>
			context.isModelLoaded && context.engine !== null,
		isNotStreaming: ({ context }) => !context.isStreaming,
		hasInput: ({ context }) => context.inputValue.trim().length > 0,
	},
}).createMachine({
	id: 'chatMachine',
	initial: 'idle',
	context: {
		// UI State
		messages: [],
		inputValue: '',
		isLoading: false,
		isStreaming: false,
		streamedContent: '',
		error: null,

		// LLM State
		engine: null,
		modelId: null,
		isModelLoaded: false,
		modelLoadingProgress: 0,
		currentChatId: null,
		usage: null,
	},
	states: {
		loadingModel: {
			entry: assign({
				modelLoadingProgress: 0,
				error: null,
			}),
			invoke: {
				src: 'createEngine',
				input: ({ event }) => ({
					modelId: (event as any).modelId,
					engineConfig: (event as any).engineConfig,
					chatOpts: (event as any).chatOpts,
				}),
				onDone: {
					target: 'idle',
					actions: ['logTransition', 'assignEngine'],
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
				MODEL_LOADING_PROGRESS: {
					actions: 'assignModelLoadingProgress',
				},
				ERROR: {
					target: 'error',
					actions: ['logTransition', 'assignError'],
				},
			},
		},
		idle: {
			on: {
				LOAD_MODEL: {
					target: 'loadingModel',
					actions: [
						'logTransition',
						assign({
							modelId: ({ event }) => (event as any).modelId,
							error: null,
						}),
					],
				},
				SET_INPUT: {
					actions: ['assignInput'],
				},
				SEND_MESSAGE: [
					{
						guard: 'isModelLoaded',
						target: 'streaming',
						actions: ['logTransition', 'assignUserMessage'],
					},
					{
						guard: 'hasInput',
						actions: assign({
							error: 'Model not loaded. Please load a model first.',
						}),
					},
				],
				CLEAR_CHAT: {
					actions: ['clearChat'],
				},
			},
		},
		streaming: {
			entry: ['assignStreaming'],
			invoke: {
				src: 'chatCompletion',
				input: ({ context }) => ({
					engine: context.engine!,
					messages: context.messages.map((msg) => ({
						role: msg.role,
						content: msg.content,
					})),
					options: {
						temperature: 0.7,
						maxTokens: 1000,
						stream: true,
					},
				}),
				onDone: {
					target: 'idle',
				},
				onError: {
					target: 'error',
					actions: 'assignChatError',
				},
			},
			on: {
				STREAM_UPDATE: {
					actions: ['assignStreamUpdate'],
				},
				RECEIVE_MESSAGE: {
					target: 'idle',
					actions: ['logTransition', 'assignReceiveMessage'],
				},
				ERROR: {
					target: 'error',
					actions: ['logTransition', 'assignError'],
				},
				STREAM_CHUNK: {
					actions: ({ event, self }) => {
						console.log(`[ChatMachine] Received STREAM_CHUNK:`, event.content)
						self.send({ type: 'STREAM_UPDATE', content: event.content })
					},
				},
				CHAT_COMPLETION_RECEIVED: {
					target: 'idle',
					actions: ({ event, self }) => {
						console.log(
							`[ChatMachine] Received CHAT_COMPLETION_RECEIVED:`,
							event.content,
						)
						self.send({ type: 'RECEIVE_MESSAGE', content: event.content })
					},
				},
				CHAT_ERROR: {
					target: 'error',
					actions: ({ event, self }) => {
						console.log(`[ChatMachine] Received CHAT_ERROR:`, event.error)
						self.send({ type: 'ERROR', error: event.error })
					},
				},
			},
		},
		error: {
			on: {
				SET_INPUT: {
					actions: ['assignInput'],
				},
				CLEAR_CHAT: {
					target: 'idle',
					actions: ['logTransition', 'clearChat'],
				},
				LOAD_MODEL: {
					target: 'loadingModel',
					actions: [
						'logTransition',
						assign({
							modelId: ({ event }) => (event as any).modelId,
							error: null,
						}),
					],
				},
			},
		},
	},
})

// Export types for external use
export type { ChatContext, ChatEvents, Message, ChatCompletionOptions }
