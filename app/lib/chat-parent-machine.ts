import { setup, assign, type ActorRefFrom } from 'xstate'
import { webLLMMachine } from './web-llm/machine'
import type {
	ChatCompletionMessageParam,
	ChatOptions,
	MLCEngineConfig,
} from '@mlc-ai/web-llm'

// Types
interface Message {
	id: string
	role: 'user' | 'assistant' | 'system'
	content: string
	timestamp: Date
}

interface ChatParentContext {
	messages: Message[]
	inputValue: string
	isLoading: boolean
	isStreaming: boolean
	streamedContent: string
	error: string | null
	modelLoaded: boolean
	llmRef?: ActorRefFrom<typeof webLLMMachine>
	modelLoadingProgress: number
}

type ChatParentEvent =
	| { type: 'SET_INPUT'; value: string }
	| { type: 'SEND_MESSAGE' }
	| { type: 'CLEAR_CHAT' }
	| {
			type: 'LOAD_MODEL'
			modelId: string
			engineConfig?: MLCEngineConfig
			chatOpts?: ChatOptions
	  }
	| { type: 'MODEL_LOADED'; ref: ActorRefFrom<typeof webLLMMachine> }
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

export const chatParentMachine = setup({
	types: {
		context: {} as ChatParentContext,
		events: {} as ChatParentEvent,
	},
	actions: {
		logTransition: ({ event, context }) => {
			console.log(`[ChatParent] Transition:`, {
				event: event.type,
				context: {
					messagesCount: context.messages.length,
					isLoading: context.isLoading,
					isStreaming: context.isStreaming,
					modelLoaded: context.modelLoaded,
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
		}),
		assignModelLoaded: assign({
			modelLoaded: true,
			llmRef: ({ event }) =>
				event.type === 'MODEL_LOADED' ? event.ref : undefined,
			error: null,
			modelLoadingProgress: 0,
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
		}),
		sendStartChatToChild: ({ context, self }) => {
			if (context.llmRef && context.messages.length > 0) {
				console.log(
					`[ChatParent] Sending START_CHAT to child machine with ${context.messages.length} messages`,
				)
				// Convert messages to the format expected by web-llm
				const chatMessages = context.messages.map((msg) => ({
					role: msg.role,
					content: msg.content,
				}))

				context.llmRef.send({
					type: 'START_CHAT',
					messages: chatMessages,
					options: {
						temperature: 0.7,
						maxTokens: 1000,
						stream: true,
					},
				})
			}
		},
		assignLLMRef: assign({
			llmRef: ({ spawn }) => {
				console.log(`[ChatParent] Spawning webLLM machine`)
				return spawn(webLLMMachine, { input: {} })
			},
		}),
		assignModelLoadingProgress: assign({
			modelLoadingProgress: ({ event }) => {
				const progress =
					event.type === 'MODEL_LOADING_PROGRESS'
						? Math.round(event.progress.progress * 100)
						: 0
				console.log(
					`[ChatParent] Updated model loading progress:`,
					progress,
					'%',
				)
				return progress
			},
		}),
		sendLoadModelToChild: ({ context, event, self }) => {
			if (event.type === 'LOAD_MODEL' && context.llmRef) {
				console.log(
					`[ChatParent] Sending LOAD_MODEL to child machine:`,
					event.modelId,
				)
				context.llmRef.send({
					type: 'LOAD_MODEL',
					modelId: event.modelId,
					engineConfig: {
						initProgressCallback: (progress) => {
							console.log(
								`[ChatParent] Model loading progress:`,
								progress.progress * 100,
								'%',
							)
							self.send({ type: 'MODEL_LOADING_PROGRESS', progress })
						},
					},
				})
			}
		},
	},
	actors: {
		llmActor: webLLMMachine,
	},
}).createMachine({
	id: 'chatParent',
	initial: 'idle',
	context: {
		messages: [],
		inputValue: '',
		isLoading: false,
		isStreaming: false,
		streamedContent: '',
		error: null,
		modelLoaded: false,
		llmRef: undefined,
		modelLoadingProgress: 0,
	},
	states: {
		loadingModel: {
			entry: ['assignLLMRef', 'sendLoadModelToChild'],
			on: {
				MODEL_LOADED: {
					target: 'idle',
					actions: ['logTransition', 'assignModelLoaded'],
				},
				MODEL_LOADING_PROGRESS: {
					actions: ['assignModelLoadingProgress'],
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
							error: null,
						}),
					],
				},
				SET_INPUT: {
					actions: ['assignInput'],
				},
				SEND_MESSAGE: {
					target: 'streaming',
					actions: ['logTransition', 'assignUserMessage'],
				},
				CLEAR_CHAT: {
					actions: ['clearChat'],
				},
			},
		},
		streaming: {
			entry: ['assignStreaming', 'sendStartChatToChild'],
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
				// Handle events from web LLM machine
				STREAM_CHUNK: {
					actions: ({
						event,
						self,
					}: {
						event: { type: 'STREAM_CHUNK'; content: string; chunk: any }
						self: any
					}) => {
						console.log(`[ChatParent] Received STREAM_CHUNK:`, event.content)
						self.send({ type: 'STREAM_UPDATE', content: event.content })
					},
				},
				CHAT_COMPLETION_RECEIVED: {
					target: 'idle',
					actions: ({
						event,
						self,
					}: {
						event: {
							type: 'CHAT_COMPLETION_RECEIVED'
							content: string
							isComplete: boolean
							usage?: any
						}
						self: any
					}) => {
						console.log(
							`[ChatParent] Received CHAT_COMPLETION_RECEIVED:`,
							event.content,
						)
						self.send({ type: 'RECEIVE_MESSAGE', content: event.content })
					},
				},
				CHAT_ERROR: {
					target: 'error',
					actions: ({
						event,
						self,
					}: {
						event: { type: 'CHAT_ERROR'; error: string }
						self: any
					}) => {
						console.log(`[ChatParent] Received CHAT_ERROR:`, event.error)
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
			},
		},
	},
})
