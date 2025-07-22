import { setup, assign, fromPromise, fromCallback } from 'xstate'
import { invariant } from '@epic-web/invariant'
import type {
	MLCEngineConfig,
	ChatOptions,
	MLCEngineInterface,
	ChatCompletionChunk,
	ChatCompletionRequestStreaming,
} from '@mlc-ai/web-llm'
import { search } from './search-engine'
import { invokeTool } from './tools'

// Types
type Message = {
	id: string
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: string
	timestamp: Date
	isStreaming?: boolean
	toolCall?: { name: string; arguments: Record<string, any> } | null
	toolResult?: any
}

type ChatContext = {
	// UI State
	messages: Message[]
	inputValue: string
	isLoading: boolean
	isStreaming: boolean
	streamedContent: string
	error: string | null
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

	// Tool State
	pendingToolCall: { name: string; arguments: Record<string, any> } | null
	toolResult: any | null

	// Configuration
	loggingEnabled: boolean
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
	| { type: 'START_STREAMING'; messageId: string }
	| {
			type: 'STREAM_CHUNK'
			content: string
			chunk: ChatCompletionChunk
			messageId: string
	  }
	| { type: 'UPDATE_MESSAGE'; messageId: string; content: string }
	| { type: 'CREATE_ASSISTANT_MESSAGE'; messageId: string }
	| {
			type: 'CHAT_COMPLETION_RECEIVED'
			content: string
			isComplete: boolean
			messageId: string
			usage?: any
	  }
	| { type: 'CHAT_ERROR'; error: string }
	| { type: 'SET_LOGGING_ENABLED'; enabled: boolean }
	| {
			type: 'TOOL_CALL_RECEIVED'
			toolCall: { name: string; arguments: Record<string, any> } | null
	  }
	| {
			type: 'TOOL_RESULT_RECEIVED'
			result: any
			messageId: string
	  }
	| { type: 'APPROVE_TOOL_EXECUTION' }
	| { type: 'REJECT_TOOL_EXECUTION' }

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

const toolInvocationActor = fromPromise(
	async ({
		input,
	}: {
		input: {
			toolCall: { name: string; arguments: Record<string, any> }
		}
	}) => {
		const { toolCall } = input
		console.log(
			'Invoking tool:',
			toolCall.name,
			'with arguments:',
			toolCall.arguments,
		)
		return await invokeTool(toolCall.name, toolCall.arguments)
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
			options: ChatCompletionRequestStreaming
		}
	}) => {
		const { engine, options } = input

		const performChat = async () => {
			try {
				// Generate message ID for this streaming session
				const messageId = crypto.randomUUID()

				// Handle streaming
				sendBack({ type: 'START_STREAMING', messageId })

				const tools = await search(options.messages)

				const toolBoundaryId = crypto.randomUUID()

				const chunks = await engine.chat.completions.create({
					...options,
					messages: [
						{
							role: 'system',
							content: tools.length
								? `
You are a helpful assistant that can use tools to help the user. Below is a list of tools and a user message. Use the tools to help the user.

${tools.map((tool) => tool.llmDescription).join('\n')}

You can respond to the user and then call a tool. To call a tool, you must use the following format:

[TOOL_CALL:${toolBoundaryId}]
{"name": "tool_name", "arguments": {}}
[/TOOL_CALL:${toolBoundaryId}]

You can also provide arguments to a tool:

[TOOL_CALL:${toolBoundaryId}]
{"name": "tool_name","arguments": {"argument_name": "argument_value"}}
[/TOOL_CALL:${toolBoundaryId}]

Here's a real example of a tool call:

[TOOL_CALL:${toolBoundaryId}]
{"name": "send_greeting","arguments": {"greeting": "Hello, world!"}}
[/TOOL_CALL:${toolBoundaryId}]
									`.trim()
								: 'You are a helpful AI assistant. Be concise and friendly in your responses.',
						},
						...options.messages,
					],
					stream: true,
					stream_options: { include_usage: true },
				})
				console.log('starting to process chunks', chunks)

				let fullContent = ''
				for await (const chunk of chunks) {
					console.log(chunk)
					const content = chunk.choices[0]?.delta.content || ''
					fullContent += content

					sendBack({
						type: 'STREAM_CHUNK',
						chunk,
						content,
						messageId,
						isComplete: false,
					})
				}

				// Get final message
				const finalMessage = await engine.getMessage()

				const toolCall = parseToolCall(finalMessage, toolBoundaryId)

				sendBack({
					type: 'TOOL_CALL_RECEIVED',
					toolCall: toolCall,
				})

				sendBack({
					type: 'CHAT_COMPLETION_RECEIVED',
					content: finalMessage,
					isComplete: true,
					messageId,
					usage: null, // Usage is included in the last chunk
				})
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

// Helper function to parse tool calls from the final message
function parseToolCall(
	message: string,
	toolBoundaryId: string,
): { name: string; arguments: Record<string, any> } | null {
	// Look for tool call pattern: [TOOL_CALL:boundaryId]...[/TOOL_CALL:boundaryId]
	const toolCallRegex = new RegExp(
		`\\[TOOL_CALL:${toolBoundaryId}\\](.*?)\\[\\/TOOL_CALL:${toolBoundaryId}\\]`,
		's',
	)

	const match = message.match(toolCallRegex)
	if (!match) {
		return null
	}

	try {
		const toolCallContent = match[1].trim()
		const toolCall = JSON.parse(toolCallContent)

		if (toolCall.name && typeof toolCall.name === 'string') {
			return {
				name: toolCall.name,
				arguments: toolCall.arguments || {},
			}
		}
	} catch (error) {
		console.error('Failed to parse tool call:', error)
	}

	return null
}

// Create the merged state machine
export const chatMachine = setup({
	types: {
		context: {} as ChatContext,
		events: {} as ChatEvents,
	},
	actors: {
		createEngine: createEngineActor,
		chatCompletion: chatCompletionActor,
		toolInvocation: toolInvocationActor,
	},
	actions: {
		logTransition: ({ event, context }) => {
			if (context.loggingEnabled) {
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
			}
		},
		assignInput: assign({
			inputValue: ({ event }) =>
				event.type === 'SET_INPUT' ? event.value : '',
		}),
		assignError: assign({
			error: ({ event }) => (event as any).error || null,
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
				return progress
			},
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
			messages: ({ context, event }) => {
				invariant(
					event.type === 'START_STREAMING',
					'createAssistantMessage should only be called with START_STREAMING events',
				)
				return [
					...context.messages,
					{
						id: event.messageId,
						role: 'assistant',
						content: '',
						timestamp: new Date(),
						isStreaming: true,
					} as Message,
				]
			},
			isStreaming: true,
			isLoading: false,
			error: null,
		}),
		updateMessage: assign({
			messages: ({ context, event }) => {
				if (event.type !== 'UPDATE_MESSAGE') return context.messages
				return context.messages.map((msg) =>
					msg.id === event.messageId ? { ...msg, content: event.content } : msg,
				)
			},
		}),

		assignChatError: assign({
			error: ({ event }) => (event as any).error,
			isStreaming: false,
			isLoading: false,
		}),
		completeCurrentMessage: assign({
			messages: ({ context, event }) => {
				invariant(
					event.type === 'CHAT_COMPLETION_RECEIVED',
					'completeCurrentMessage should only be called with CHAT_COMPLETION_RECEIVED events',
				)
				return context.messages.map((msg) =>
					msg.id === event.messageId ? { ...msg, isStreaming: false } : msg,
				)
			},
			isStreaming: false,
			isLoading: false,
		}),
		startNextChatCompletion: assign({
			isStreaming: true,
			isLoading: false,
			error: null,
		}),
		setLoggingEnabled: assign({
			loggingEnabled: ({ event }) => {
				invariant(
					event.type === 'SET_LOGGING_ENABLED',
					'setLoggingEnabled should only be called with SET_LOGGING_ENABLED events',
				)
				return event.enabled
			},
		}),
		assignPendingToolCall: assign({
			pendingToolCall: ({ event }) => {
				invariant(
					event.type === 'TOOL_CALL_RECEIVED',
					'assignPendingToolCall should only be called with TOOL_CALL_RECEIVED events',
				)
				return event.toolCall
			},
		}),
		clearToolState: assign({
			pendingToolCall: null,
			toolResult: null,
		}),
		assignToolResult: assign({
			toolResult: ({ event }) => (event as any).output,
			isLoading: false,
		}),
		assignToolError: assign({
			error: ({ event }) =>
				(event as any).error?.message || 'Tool execution failed',
			isLoading: false,
		}),
		addToolMessage: assign({
			messages: ({ context, event }) => {
				invariant(
					event.type === 'TOOL_RESULT_RECEIVED',
					'addToolMessage should only be called with TOOL_RESULT_RECEIVED events',
				)
				const toolMessage: Message = {
					id: crypto.randomUUID(),
					role: 'tool',
					content: JSON.stringify(event.result),
					timestamp: new Date(),
					toolCall: context.pendingToolCall,
					toolResult: event.result,
				}
				return [...context.messages, toolMessage]
			},
			pendingToolCall: null,
		}),
		handleToolCompletion: assign({
			messages: ({ context, event }) => {
				const toolMessage: Message = {
					id: crypto.randomUUID(),
					role: 'tool',
					content: JSON.stringify((event as any).output),
					timestamp: new Date(),
					toolCall: context.pendingToolCall,
					toolResult: (event as any).output,
				}
				return [...context.messages, toolMessage]
			},
			toolResult: ({ event }) => (event as any).output,
			pendingToolCall: null,
		}),
		continueAfterTool: assign({
			isLoading: true,
			isStreaming: true,
		}),
	},
	guards: {
		isModelLoaded: ({ context }) =>
			context.isModelLoaded && context.engine !== null,
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
		messageQueue: [],

		// LLM State
		engine: null,
		modelId: null,
		isModelLoaded: false,
		modelLoadingProgress: 0,
		usage: null,

		// Tool State
		pendingToolCall: null,
		toolResult: null,

		// Configuration
		loggingEnabled: true,
	},
	states: {
		idle: {
			id: 'idle',
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
				SET_LOGGING_ENABLED: {
					actions: ['setLoggingEnabled'],
				},
				TOOL_CALL_RECEIVED: {
					actions: ({ event }) => {
						console.log('Tool call received:', event.toolCall)
					},
				},
				TOOL_RESULT_RECEIVED: {
					actions: ({ event }) => {
						console.log('Tool result received:', event.result)
					},
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
				SET_LOGGING_ENABLED: {
					actions: ['setLoggingEnabled'],
				},
				TOOL_CALL_RECEIVED: {
					actions: ({ event }) => {
						console.log('Tool call received:', event.toolCall)
					},
				},
				TOOL_RESULT_RECEIVED: {
					actions: ({ event }) => {
						console.log('Tool result received:', event.result)
					},
				},
			},
		},
		streaming: {
			id: 'streaming',
			invoke: {
				src: 'chatCompletion',
				input: ({ context }) => ({
					engine: context.engine!,
					options: {
						temperature: 0.7,
						stream: true,
						messages: context.messages.map((msg) => ({
							role: msg.role,
							content: msg.content,
						})),
					} as ChatCompletionRequestStreaming,
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
				START_STREAMING: {
					actions: ['logTransition', 'createAssistantMessage'],
				},
				STREAM_CHUNK: {
					actions: ({ context, event, self }) => {
						invariant(
							event.type === 'STREAM_CHUNK',
							'Invalid event. chatCompletion should only be invoked with STREAM_CHUNK events',
						)

						// Update the streaming message with the full appended content
						const currentMessage = context.messages.find(
							(msg) => msg.id === event.messageId,
						)
						const currentContent = currentMessage?.content || ''
						const fullContent = currentContent + event.content

						self.send({
							type: 'UPDATE_MESSAGE',
							messageId: event.messageId,
							content: fullContent,
						})
					},
				},
				UPDATE_MESSAGE: {
					actions: ['logTransition', 'updateMessage'],
				},
				SET_LOGGING_ENABLED: {
					actions: ['setLoggingEnabled'],
				},
				TOOL_CALL_RECEIVED: [
					{
						guard: ({ event }) => event.toolCall !== null,
						target: 'toolCall',
						actions: ['assignPendingToolCall'],
					},
					{
						actions: ({ event }) => {
							console.log('No tool call found in response')
						},
					},
				],
				TOOL_RESULT_RECEIVED: {
					actions: ['addToolMessage'],
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
						actions: ['logTransition', 'completeCurrentMessage'],
					},
				],
				CHAT_ERROR: [
					{
						guard: ({ context }) => context.messageQueue.length > 0,
						target: 'processingQueue',
						actions: ['logTransition', 'processQueue'],
					},
					{
						target: 'error',
						actions: ['logTransition'],
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
		toolCall: {
			initial: 'waitingForApproval',
			entry: assign({
				isLoading: false,
				error: null,
			}),
			on: {
				REJECT_TOOL_EXECUTION: {
					target: 'idle',
					actions: ['clearToolState'],
				},
			},
			states: {
				waitingForApproval: {
					on: {
						APPROVE_TOOL_EXECUTION: {
							target: 'executing',
							actions: assign({
								isLoading: true,
							}),
						},
						SET_INPUT: {
							actions: ['assignInput'],
						},
						SET_LOGGING_ENABLED: {
							actions: ['setLoggingEnabled'],
						},
					},
				},
				executing: {
					invoke: {
						src: 'toolInvocation',
						input: ({ context }) => ({
							toolCall: context.pendingToolCall!,
						}),
						onDone: {
							target: '#streaming',
							actions: ['handleToolCompletion'],
						},
						onError: {
							target: '#error',
							actions: ['assignToolError'],
						},
					},
					on: {
						SET_INPUT: {
							actions: ['assignInput'],
						},
						SET_LOGGING_ENABLED: {
							actions: ['setLoggingEnabled'],
						},
					},
				},
			},
		},
		error: {
			id: 'error',
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
				SET_LOGGING_ENABLED: {
					actions: ['setLoggingEnabled'],
				},
				TOOL_CALL_RECEIVED: {
					actions: ({ event }) => {
						console.log('Tool call received:', event.toolCall)
					},
				},
				TOOL_RESULT_RECEIVED: {
					actions: ({ event }) => {
						console.log('Tool result received:', event.result)
					},
				},
			},
		},
	},
})

// Export types for external use
export type { ChatContext, ChatEvents, Message }
