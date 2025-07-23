import { setup, assign, fromPromise, fromCallback } from 'xstate'
import { invariant } from '@epic-web/invariant'
import { search } from './search-engine.js'
import { invokeTool, getAvailableTools } from './tools.js'
import type {
	ChatCompletionMessageParam,
	MLCEngineInterface,
	ChatCompletionRequestStreaming,
} from '@mlc-ai/web-llm'

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
	engine?: MLCEngineInterface
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

// Helper function to parse tool calls from the LLM response
function parseToolCall(
	content: string,
	toolBoundaryId: string,
): ToolCall | null {
	const toolCallRegex = new RegExp(
		`\\[TOOL_CALL:${toolBoundaryId}\\](.*?)\\[\\/TOOL_CALL:${toolBoundaryId}\\]`,
		's',
	)

	const match = content.match(toolCallRegex)
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

export const chatMachine = setup({
	types: {
		context: {} as ChatContext,
		events: {} as ChatEvent,
		input: {} as { initialMessages?: Message[] },
	},
	actions: {
		startToolSearch: () => {
			// This action is called when entering the searchingTools state
			// The actual tool search is handled by the toolSearch actor
		},
		startGenerating: () => {
			// This action is called when entering the generatingResponse state
			// The actual generation is handled by the generation actor
		},
		cancelToolSearch: () => {
			// This action is called when interrupting during tool search
			// The actor will be automatically stopped by XState
		},
		cancelGeneration: () => {
			// This action is called when interrupting during generation
			// The actor will be automatically stopped by XState
		},
		cancelStream: () => {
			// This action is called when interrupting during streaming
			// The actor will be automatically stopped by XState
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
			// This action is called when entering the callingTool state
			// The actual tool call is handled by the toolCall actor
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
				// Handle XState error events from promise actors
				if (event.type.startsWith('xstate.error.actor') && 'error' in event) {
					const error = (event as any).error
					return error instanceof Error ? error.message : String(error)
				}
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
		setEngine: assign({
			engine: ({ event }) => {
				if (event.type.startsWith('xstate.done.actor') && 'output' in event) {
					return (event as any).output
				}
				return undefined
			},
		}),
		updateStreamedContent: assign({
			streamedContent: ({ context, event }) => {
				if (event.type === 'STREAM_CHUNK') {
					return context.streamedContent + event.content
				}
				return context.streamedContent
			},
		}),
		clearStreamedContent: assign({
			streamedContent: () => '',
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
		modelLoader: fromPromise(
			async ({ input }: { input: { modelId: string } }) => {
				try {
					const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

					// Create engine with progress callback
					const engine = await CreateMLCEngine(input.modelId, {
						initProgressCallback: (progress) => {
							// Note: Progress updates won't work with fromPromise
							// Would need a different approach for real progress updates
							console.log(
								'Model load progress:',
								Math.round(progress.progress * 100),
							)
						},
					})

					return engine
				} catch (error) {
					throw new Error(
						error instanceof Error ? error.message : 'Failed to load model',
					)
				}
			},
		),
		toolSearch: fromPromise(
			async ({ input }: { input: { messages: Message[] } }) => {
				// Convert messages to ChatCompletionMessageParam format
				const chatMessages = input.messages
					.filter((msg) => msg.role !== 'tool')
					.map((msg) => ({
						role: msg.role as 'user' | 'assistant' | 'system',
						content: msg.content,
					}))

				// Use the search engine to find relevant tools
				const relevantTools = await search(chatMessages)

				return {
					hasTools: relevantTools.length > 0,
					tools: relevantTools.map((tool) => tool.function.name),
					toolDefinitions: relevantTools,
				}
			},
		),
		generation: fromPromise(
			async ({ input }: { input: { messages: Message[]; tools?: any[] } }) => {
				// Skip generation and go directly to streaming
				// Pass through the tools from tool search
				return {
					content: '',
					toolCall: undefined,
					toolDefinitions: input.tools,
				}
			},
		),
		streaming: fromCallback(
			({
				sendBack,
				input,
			}: {
				sendBack: any
				input: {
					messages: Message[]
					tools?: any[]
					engine?: MLCEngineInterface
				}
			}) => {
				const performStreaming = async () => {
					try {
						invariant(input.engine, 'Engine is required')

						// Real LLM implementation
						const toolBoundaryId = crypto.randomUUID()
						const messages: ChatCompletionMessageParam[] = []

						// Add system message with tool instructions if tools are available
						if (input.tools && input.tools.length > 0) {
							messages.push({
								role: 'system',
								content: `You are a helpful assistant that can use tools to help the user. Below is a list of tools available:

${input.tools.map((tool: any) => tool.llmDescription).join('\n')}

To call a tool, use this exact format:
[TOOL_CALL:${toolBoundaryId}]
{"name": "tool_name", "arguments": {"arg1": "value1"}}
[/TOOL_CALL:${toolBoundaryId}]

Only call tools when necessary to help the user.`,
							})
						} else {
							messages.push({
								role: 'system',
								content:
									'You are a helpful AI assistant. Be concise and friendly in your responses.',
							})
						}

						// Add conversation messages
						messages.push(
							...input.messages
								.filter((msg) => msg.role !== 'tool')
								.map((msg) => ({
									role: msg.role as 'user' | 'assistant' | 'system',
									content: msg.content,
								})),
						)

						// Create streaming chat completion
						const stream = await input.engine.chat.completions.create({
							messages,
							stream: true,
							temperature: 0.7,
							max_tokens: 1000,
						})

						let fullContent = ''
						for await (const chunk of stream) {
							const content = chunk.choices[0]?.delta?.content || ''
							if (content) {
								fullContent += content
								sendBack({ type: 'STREAM_CHUNK', content })
							}
						}

						// Parse for tool calls
						const toolCall = parseToolCall(fullContent, toolBoundaryId)

						// Send completion event
						sendBack({
							type: 'xstate.done.actor',
							output: {
								content: fullContent,
								toolCall,
							},
						})
					} catch (error) {
						sendBack({
							type: 'STREAM_ERROR',
							error:
								error instanceof Error ? error.message : 'Streaming failed',
						})
					}
				}

				performStreaming()

				return () => {
					// Cleanup function
				}
			},
		),
		toolCall: fromPromise(async ({ input }: { input: ToolCall }) => {
			// Call the actual tool using the tools module
			const result = await invokeTool(input.name, input.arguments)
			return { result: JSON.stringify(result) }
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
		engine: undefined,
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
			invoke: {
				src: 'modelLoader',
				input: ({ event }) => {
					invariant(event.type === 'LOAD_MODEL', 'Expected LOAD_MODEL event')
					return { modelId: event.modelId }
				},
				onDone: {
					target: 'ready',
					actions: ['setEngine'],
				},
				onError: {
					target: 'loadFailed',
					actions: ['setError'],
				},
			},
			on: {
				MODEL_LOAD_PROGRESS: {
					actions: ['updateModelLoadProgress'],
				},
				MODEL_LOAD_SUCCESS: {
					// This is handled by onDone
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
				input: ({ context }) => ({ messages: context.messages }),
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
				input: ({ context, event }) => {
					// Pass messages and any tools from the tool search
					if (event.type.startsWith('xstate.done.actor') && 'output' in event) {
						return {
							messages: context.messages,
							tools: (event as any).output.toolDefinitions,
						}
					}
					return { messages: context.messages }
				},
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
			entry: ['clearStreamedContent'],
			invoke: {
				src: 'streaming',
				input: ({ context, event }) => {
					// Pass messages, tools, and engine from the generation
					if (event.type.startsWith('xstate.done.actor') && 'output' in event) {
						return {
							messages: context.messages,
							tools: (event as any).output.toolDefinitions,
							engine: context.engine,
						}
					}
					return { messages: context.messages, engine: context.engine }
				},
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
				STREAM_CHUNK: {
					actions: ['updateStreamedContent'],
				},
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
