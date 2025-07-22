import { setup, assign, fromPromise, fromCallback } from 'xstate'
import { invariant } from '@epic-web/invariant'
import type {
	MLCEngineConfig,
	ChatOptions,
	MLCEngineInterface,
	ChatCompletionMessageParam,
} from '@mlc-ai/web-llm'

// Types
type Message = {
	id: string
	role: 'user' | 'assistant' | 'system'
	content: string
	timestamp: Date
	isStreaming?: boolean
}

type ChatContext = {
	// UI State
	messages: Message[]
	inputValue: string
	isLoading: boolean
	isStreaming: boolean
	streamedContent: string
	error: string | null
	currentStreamingMessageId: string | null
	messageQueue: string[]

	// LLM State
	engine: MLCEngineInterface | null
	modelId: string | null
	isModelLoaded: boolean
	modelLoadingProgress: number
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
	| { type: 'RECEIVE_MESSAGE'; content: string }
	| { type: 'ERROR'; error: string }
	| { type: 'STREAM_CHUNK'; content: string; chunk: any }
	| { type: 'UPDATE_MESSAGE'; messageId: string; content: string }
	| { type: 'CREATE_ASSISTANT_MESSAGE'; messageId: string }
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
					throw new Error('non-streaming is not supported')
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
			console.log(`[ChatMachine] Transition:`, event.type, {
				event,
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
			currentStreamingMessageId: null,
			messageQueue: [],
			modelLoadingProgress: 0,
			usage: null,
		}),
		queueMessage: assign({
			messageQueue: ({ context }) => [
				...context.messageQueue,
				context.inputValue,
			],
			inputValue: '',
			error: null,
		}),
		processQueue: assign({
			messages: ({ context }) => [
				...context.messages,
				...context.messageQueue.map((content) => ({
					id: crypto.randomUUID(),
					role: 'user' as const,
					content,
					timestamp: new Date(),
				})),
			],
			messageQueue: [],
			error: null,
			streamedContent: '',
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
			currentStreamingMessageId: () => crypto.randomUUID(),
		}),

		assignReceiveMessage: assign({
			messages: ({ context, event }) => {
				if (event.type !== 'RECEIVE_MESSAGE') return context.messages
				return [
					...context.messages,
					{
						id: crypto.randomUUID(),
						role: 'assistant',
						content: context.streamedContent,
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
			streamedContent: '',
		}),
		createAssistantMessage: assign({
			messages: ({ context }) => {
				return [
					...context.messages,
					{
						id: context.currentStreamingMessageId!,
						role: 'assistant',
						content: '',
						timestamp: new Date(),
						isStreaming: true,
					} as Message,
				]
			},
		}),
		updateMessage: assign({
			messages: ({ context, event }) => {
				if (event.type !== 'UPDATE_MESSAGE') return context.messages
				return context.messages.map((msg) =>
					msg.id === event.messageId ? { ...msg, content: event.content } : msg,
				)
			},
		}),

		assignStreamChunk: assign({
			streamedContent: ({ context, event }) =>
				context.streamedContent + (event as any).content,
			isStreaming: true,
		}),
		assignChatCompletion: assign({
			streamedContent: ({ event }) => {
				invariant(
					event.type === 'CHAT_COMPLETION_RECEIVED',
					'Invalid event. This should only be invoked with CHAT_COMPLETION_RECEIVED events',
				)

				return event.content
			},
			isStreaming: false,
			usage: ({ event }) => (event as any).usage || null,
		}),
		assignChatError: assign({
			error: ({ event }) => (event as any).error,
			isStreaming: false,
			isLoading: false,
		}),
		completeCurrentMessage: assign({
			messages: ({ context }) => {
				return context.messages.map((msg) =>
					msg.id === context.currentStreamingMessageId
						? { ...msg, isStreaming: false }
						: msg,
				)
			},
			currentStreamingMessageId: null,
			isStreaming: false,
			isLoading: false,
		}),
		startNextChatCompletion: assign({
			isStreaming: true,
			isLoading: false,
			error: null,
			currentStreamingMessageId: () => crypto.randomUUID(),
		}),
		reset: assign({
			engine: null,
			modelId: null,
			isModelLoaded: false,
			modelLoadingProgress: 0,
			error: null,
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
		currentStreamingMessageId: null,
		messageQueue: [],

		// LLM State
		engine: null,
		modelId: null,
		isModelLoaded: false,
		modelLoadingProgress: 0,
		usage: null,
	},
	states: {
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
						actions: ['logTransition', 'queueMessage'],
					},
				],
				CLEAR_CHAT: {
					actions: ['clearChat'],
				},
			},
		},
		loadingModel: {
			entry: assign({
				modelLoadingProgress: 0,
				error: null,
			}),
			invoke: {
				src: 'createEngine',
				input: ({ event }) => {
					invariant(
						event.type === 'LOAD_MODEL',
						'Invalid event. createEngine should only be invoked with LOAD_MODEL events',
					)

					return {
						modelId: event.modelId,
						engineConfig: event.engineConfig,
						chatOpts: event.chatOpts,
					}
				},
				onDone: [
					{
						guard: ({ context }) => context.messageQueue.length > 0,
						target: 'streaming',
						actions: ['logTransition', 'assignEngine', 'processQueue'],
					},
					{
						target: 'idle',
						actions: ['logTransition', 'assignEngine'],
					},
				],
				onError: {
					target: 'error',
					actions: assign({
						error: ({ event }) =>
							(event as any).error?.message || 'Failed to load model',
					}),
				},
			},
			on: {
				SET_INPUT: {
					actions: ['assignInput'],
				},
				SEND_MESSAGE: [
					{
						guard: 'hasInput',
						actions: ['logTransition', 'queueMessage'],
					},
				],
				MODEL_LOADING_PROGRESS: {
					actions: 'assignModelLoadingProgress',
				},
				ERROR: {
					target: 'error',
					actions: ['logTransition', 'assignError'],
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
				SET_INPUT: {
					actions: ['assignInput'],
				},
				SEND_MESSAGE: [
					{
						guard: 'hasInput',
						actions: ['logTransition', 'queueMessage'],
					},
				],
				RECEIVE_MESSAGE: {
					target: 'idle',
					actions: ['logTransition', 'assignReceiveMessage'],
				},
				ERROR: {
					target: 'error',
					actions: ['logTransition', 'assignError'],
				},
				STREAM_CHUNK: {
					actions: ({ context, event, self }) => {
						invariant(
							event.type === 'STREAM_CHUNK',
							'Invalid event. chatCompletion should only be invoked with STREAM_CHUNK events',
						)

						// Create assistant message on first chunk if it doesn't exist
						if (
							!context.messages.some(
								(msg) => msg.id === context.currentStreamingMessageId,
							)
						) {
							self.send({
								type: 'CREATE_ASSISTANT_MESSAGE',
								messageId: context.currentStreamingMessageId!,
							})
						}

						// Update the streaming message with the full appended content
						if (context.currentStreamingMessageId) {
							const currentMessage = context.messages.find(
								(msg) => msg.id === context.currentStreamingMessageId,
							)
							const currentContent = currentMessage?.content || ''
							const fullContent = currentContent + event.content

							self.send({
								type: 'UPDATE_MESSAGE',
								messageId: context.currentStreamingMessageId,
								content: fullContent,
							})
						}
					},
				},
				UPDATE_MESSAGE: {
					actions: ['logTransition', 'updateMessage'],
				},
				CREATE_ASSISTANT_MESSAGE: {
					actions: ['logTransition', 'createAssistantMessage'],
				},

				CHAT_COMPLETION_RECEIVED: [
					{
						guard: ({ context }) => context.messageQueue.length > 0,
						target: 'processingQueue',
						actions: [
							'logTransition',
							'completeCurrentMessage',
							'processQueue',
						],
					},
					{
						target: 'idle',
						actions: [
							'logTransition',
							'completeCurrentMessage',
							({ context }) => {
								console.log(
									`[ChatMachine] Received CHAT_COMPLETION_RECEIVED:`,
									context.streamedContent,
								)
							},
						],
					},
				],
				CHAT_ERROR: [
					{
						guard: ({ context }) => context.messageQueue.length > 0,
						target: 'processingQueue',
						actions: [
							'logTransition',
							'completeCurrentMessage',
							'processQueue',
						],
					},
					{
						target: 'error',
						actions: [
							'logTransition',
							'completeCurrentMessage',
							({ event, self }) => {
								console.log(`[ChatMachine] Received CHAT_ERROR:`, event.error)
								self.send({ type: 'ERROR', error: event.error })
							},
						],
					},
				],
			},
		},
		processingQueue: {
			entry: ['startNextChatCompletion'],
			always: {
				target: 'streaming',
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
							modelId: ({ event }) => {
								invariant(
									event.type === 'LOAD_MODEL',
									'Invalid event. This should only be invoked with LOAD_MODEL events',
								)

								return event.modelId
							},
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
