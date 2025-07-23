import { setup, assign, fromPromise, fromCallback } from 'xstate'
import { invariant } from '@epic-web/invariant'

export type BaseMessage = {
	id: string
	content: string
	timestamp: Date
}

export type UserMessage = BaseMessage & { role: 'user' }
export type AssistantMessage = BaseMessage & { role: 'assistant' }
export type SystemMessage = BaseMessage & { role: 'system' }
export type ToolMessage = BaseMessage & {
	role: 'tool'
	toolCall: {
		name: string
		arguments: Record<string, any>
		result?: string
	}
}

export type Message =
	| UserMessage
	| AssistantMessage
	| SystemMessage
	| ToolMessage

export type ToolCall = {
	name: string
	arguments: Record<string, any>
}

export type ChatContext = {
	messages: Message[]
	messageQueue: Message[]
	currentModelId?: string
	modelLoadProgress: number
	lastError?: string
	currentToolCall?: ToolCall
	streamedContent: string
}

export type ChatEvent =
	| { type: 'LOAD_MODEL'; modelId: string }
	| { type: 'QUEUE_MESSAGE'; message: Message }
	| { type: 'MODEL_LOAD_PROGRESS'; progress: number }
	| { type: 'MODEL_LOAD_SUCCESS' }
	| { type: 'MODEL_LOAD_FAILURE'; error: string }
	| { type: 'INTERRUPT' }
	| { type: 'APPROVE_TOOL_CALL' }
	| { type: 'REJECT_TOOL_CALL' }
	| { type: 'STREAM_ERROR'; error: string }
	| { type: 'STREAM_CHUNK'; content: string }
	| { type: 'STREAM_COMPLETE'; content: string; toolCall?: ToolCall }
	| { type: 'RETRY_TOOL_SEARCH' }
	| { type: 'RETRY_GENERATION' }
	| { type: 'RETRY_TOOL_CALL' }
	| { type: 'done.invoke.toolCall'; output: { result: string } }
	| {
			type: 'done.invoke.generation'
			output: { content: string; toolCall?: ToolCall }
	  }
	| {
			type: 'done.invoke.streaming'
			output: { content: string; toolCall?: ToolCall }
	  }

export const chatMachine = setup({
	types: {
		context: {} as ChatContext,
		events: {} as ChatEvent,
		input: {} as { initialMessages?: Message[] },
	},
	actions: {
		startToolSearch: () => {
			console.log('Starting tool search...')
		},
		startGenerating: () => {
			console.log('Starting generation...')
		},
		cancelToolSearch: () => {
			console.log('Cancelling tool search...')
		},
		cancelGeneration: () => {
			console.log('Cancelling generation...')
		},
		cancelStream: () => {
			console.log('Cancelling stream...')
		},
		appendToolResponseMessage: assign({
			messages: ({ context, event }) => {
				if (
					event.type.startsWith('xstate.done.actor') &&
					'output' in event &&
					context.currentToolCall
				) {
					const toolMessage: ToolMessage = {
						id: crypto.randomUUID(),
						role: 'tool',
						content: (event as any).output.result,
						timestamp: new Date(),
						toolCall: {
							name: context.currentToolCall.name,
							arguments: context.currentToolCall.arguments,
							result: (event as any).output.result,
						},
					}
					return [...context.messages, toolMessage]
				}
				return context.messages
			},
		}),
		appendToolRejectionMessage: assign({
			messages: ({ context }) => {
				const rejectionMessage: AssistantMessage = {
					id: crypto.randomUUID(),
					role: 'assistant',
					content: 'Tool call was rejected.',
					timestamp: new Date(),
				}
				return [...context.messages, rejectionMessage]
			},
		}),
		callTool: () => {
			console.log('Calling tool...')
		},
		queueMessage: assign({
			messageQueue: ({ context, event }) => {
				invariant(
					event.type === 'QUEUE_MESSAGE',
					'Expected QUEUE_MESSAGE event',
				)
				return [...context.messageQueue, event.message]
			},
		}),
		processMessageQueue: assign({
			messages: ({ context }) => {
				if (context.messageQueue.length === 0) return context.messages
				return [...context.messages, ...context.messageQueue]
			},
			messageQueue: () => [],
		}),
		updateModelLoadProgress: assign({
			modelLoadProgress: ({ event }) => {
				invariant(
					event.type === 'MODEL_LOAD_PROGRESS',
					'Expected MODEL_LOAD_PROGRESS event',
				)
				return event.progress
			},
		}),
		setCurrentModel: assign({
			currentModelId: ({ event }) => {
				invariant(event.type === 'LOAD_MODEL', 'Expected LOAD_MODEL event')
				return event.modelId
			},
		}),
		setError: assign({
			lastError: ({ event }) => {
				if (event.type === 'MODEL_LOAD_FAILURE') return event.error
				if (event.type === 'STREAM_ERROR') return event.error
				return undefined
			},
		}),
		setToolCall: assign({
			currentToolCall: ({ event }) => {
				if (event.type.startsWith('xstate.done.actor') && 'output' in event) {
					return (event as any).output.toolCall
				}
				return undefined
			},
		}),
		clearToolCall: assign({
			currentToolCall: () => undefined,
		}),

		appendStreamedMessage: assign({
			messages: ({ context, event }) => {
				// Handle the xstate.done.actor event for streaming actor
				if (event.type.startsWith('xstate.done.actor') && 'output' in event) {
					const assistantMessage: AssistantMessage = {
						id: crypto.randomUUID(),
						role: 'assistant',
						content: (event as any).output.content,
						timestamp: new Date(),
					}
					return [...context.messages, assistantMessage]
				}
				return context.messages
			},
			streamedContent: () => '',
		}),
		clearError: assign({
			lastError: () => undefined,
		}),
	},
	guards: {
		hasQueuedMessages: ({ context }) => context.messageQueue.length > 0,
		hasToolCall: ({ event }) => {
			// XState v5 uses 'xstate.done.actor' format instead of 'done.invoke'
			if (event.type.startsWith('xstate.done.actor') && 'output' in event) {
				return !!(event as any).output.toolCall
			}
			return false
		},
	},
	actors: {
		toolSearch: fromPromise(async () => {
			throw new Error('toolSearch actor not implemented')
		}),
		generation: fromPromise(async () => {
			throw new Error('generation actor not implemented')
		}),
		streaming: fromPromise(async () => {
			throw new Error('streaming actor not implemented')
		}),
		toolCall: fromPromise(async ({ input }: { input: ToolCall }) => {
			throw new Error('toolCall actor not implemented')
		}),
	},
}).createMachine({
	id: 'chat',
	initial: 'idle',
	context: ({ input }) => ({
		messages: input?.initialMessages || [],
		messageQueue: [],
		currentModelId: undefined,
		modelLoadProgress: 0,
		lastError: undefined,
		currentToolCall: undefined,
		streamedContent: '',
	}),
	states: {
		idle: {
			on: {
				LOAD_MODEL: {
					target: 'loadingModel',
					actions: ['setCurrentModel'],
				},
				QUEUE_MESSAGE: {
					actions: ['queueMessage'],
				},
			},
		},
		loadingModel: {
			on: {
				MODEL_LOAD_PROGRESS: {
					actions: ['updateModelLoadProgress'],
				},
				MODEL_LOAD_SUCCESS: {
					target: 'ready',
				},
				MODEL_LOAD_FAILURE: {
					target: 'loadFailed',
					actions: ['setError'],
				},
				QUEUE_MESSAGE: {
					actions: ['queueMessage'],
				},
			},
		},
		loadFailed: {
			on: {
				LOAD_MODEL: {
					target: 'loadingModel',
					actions: ['setCurrentModel', 'clearError'],
				},
			},
		},
		ready: {
			entry: ['processMessageQueue'],
			always: [
				{
					guard: 'hasQueuedMessages',
					target: 'searchingTools',
				},
			],
			on: {
				QUEUE_MESSAGE: {
					actions: ['queueMessage', 'processMessageQueue'],
					target: 'searchingTools',
				},
				LOAD_MODEL: {
					target: 'loadingModel',
					actions: ['setCurrentModel'],
				},
			},
		},
		searchingTools: {
			entry: ['startToolSearch'],
			invoke: {
				src: 'toolSearch',
				onDone: {
					target: 'generatingResponse',
				},
				onError: {
					target: 'ready',
				},
			},
			on: {
				INTERRUPT: {
					target: 'ready',
					actions: ['cancelToolSearch'],
				},
				QUEUE_MESSAGE: {
					actions: ['queueMessage'],
				},
			},
		},
		generatingResponse: {
			entry: ['startGenerating'],
			invoke: {
				src: 'generation',
				onDone: {
					target: 'streamingResponse',
					actions: ['setToolCall'],
				},
				onError: {
					target: 'ready',
				},
			},
			on: {
				INTERRUPT: {
					target: 'ready',
					actions: ['cancelGeneration'],
				},
				QUEUE_MESSAGE: {
					actions: ['queueMessage'],
				},
			},
		},
		streamingResponse: {
			invoke: {
				src: 'streaming',
				onDone: [
					{
						guard: 'hasToolCall',
						target: 'waitingForToolApproval',
						actions: ['appendStreamedMessage', 'setToolCall'],
					},
					{
						target: 'ready',
						actions: ['appendStreamedMessage'],
					},
				],
				onError: {
					target: 'ready',
				},
			},
			on: {
				STREAM_ERROR: {
					target: 'ready',
					actions: ['setError', 'cancelStream'],
				},
				INTERRUPT: {
					target: 'ready',
					actions: ['cancelStream'],
				},
				QUEUE_MESSAGE: {
					actions: ['queueMessage'],
				},
			},
		},
		waitingForToolApproval: {
			on: {
				APPROVE_TOOL_CALL: {
					target: 'callingTool',
				},
				REJECT_TOOL_CALL: {
					target: 'searchingTools',
					actions: ['appendToolRejectionMessage', 'clearToolCall'],
				},
				INTERRUPT: {
					target: 'searchingTools',
					actions: ['appendToolRejectionMessage', 'clearToolCall'],
				},
			},
		},
		callingTool: {
			entry: ['callTool'],
			invoke: {
				src: 'toolCall',
				input: ({ context }) => context.currentToolCall!,
				onDone: {
					target: 'searchingTools',
					actions: ['appendToolResponseMessage', 'clearToolCall'],
				},
				onError: {
					target: 'ready',
					actions: ['clearToolCall'],
				},
			},
			on: {
				INTERRUPT: {
					target: 'searchingTools',
					actions: ['appendToolRejectionMessage', 'clearToolCall'],
				},
			},
		},
	},
})
