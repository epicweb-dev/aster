import type { MLCEngine } from '@mlc-ai/web-llm'
import { getErrorMessage, parseToolCall } from './utils'
import { invokeTool } from './tools'

// Reuse message types from the existing chat machine
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
		id: string
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

export type ChatStatus =
	| 'idle'
	| 'loadingModel'
	| 'ready'
	| 'searching'
	| 'generating'
	| 'awaitingToolApproval'
	| 'executingTool'

export type ChatState = {
	status: ChatStatus
	currentModelId?: string
	modelLoadProgress: {
		status: 'idle' | 'pending' | 'success' | 'error'
		value: number
	}
	lastError?: {
		cause: string
		message: string
		stack?: string
	}
	messages: Array<Message>
	queuedMessages: Array<Message>
	engine?: MLCEngine
	assistantMessageId?: string
	toolBoundaryId?: string
	pendingToolCall?: {
		name: string
		arguments: Record<string, any>
	}
	bufferedToolContent?: string
	streamBuffer?: string
	logLevel?: LogLevel
	toolCallRequests: Record<string, ToolCallRequest>
	currentToolRequestId?: string
}

export type ToolCallRequest = {
	id: string
	assistantMessageId: string
	toolCall: {
		name: string
		arguments: Record<string, any>
	}
	bufferedContent: string
	status:
		| 'pending'
		| 'approved'
		| 'rejected'
		| 'executing'
		| 'completed'
		| 'error'
	result?: string
	error?: string
}

export type ChatAction =
	| {
			type: 'LOAD_MODEL'
			payload: { modelId: string }
	  }
	| {
			type: 'MODEL_LOAD_PROGRESS'
			payload: { progress: number }
	  }
	| {
			type: 'MODEL_LOAD_SUCCESS'
			payload: { engine: MLCEngine }
	  }
	| {
			type: 'MODEL_LOAD_ERROR'
			payload: { error: Error }
	  }
	| {
			type: 'ADD_MESSAGE'
			payload: { content: string }
	  }
	| {
			type: 'START_GENERATION'
	  }
	| {
			type: 'STREAM_CHUNK'
			payload: { chunk: string }
	  }
	| {
			type: 'GENERATION_COMPLETE'
	  }
	| {
			type: 'GENERATION_ERROR'
			payload: { error: Error }
	  }
	| {
			type: 'CLEAR_ERROR'
	  }
	| {
			type: 'PENDING_TOOL_CALL'
			payload: {
				toolCall: {
					name: string
					arguments: Record<string, any>
				}
				bufferedContent: string
			}
	  }
	| {
			type: 'TOOL_EXECUTION_SUCCESS'
			payload: {
				toolCall: {
					id: string
					name: string
					arguments: Record<string, any>
					result: string
				}
			}
	  }
	| {
			type: 'TOOL_EXECUTION_ERROR'
			payload: {
				toolCall: {
					id: string
					name: string
					arguments: Record<string, any>
				}
				error: Error
			}
	  }
	| {
			type: 'TOOL_EXECUTION_TIMEOUT'
	  }
	| {
			type: 'APPROVE_TOOL_REQUEST'
			payload: { requestId: string }
	  }
	| {
			type: 'REJECT_TOOL_REQUEST'
			payload: { requestId: string }
	  }
	| {
			type: 'SET_STATUS'
			payload: { status: ChatStatus }
	  }

export const initialChatState: ChatState = {
	status: 'idle',
	currentModelId: undefined,
	modelLoadProgress: {
		status: 'idle',
		value: 0,
	},
	messages: [],
	queuedMessages: [],
	logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'silent',
	toolCallRequests: {},
}

function createUserMessage(content: string): UserMessage {
	return {
		id: crypto.randomUUID(),
		role: 'user',
		content,
		timestamp: new Date(),
	}
}

function createAssistantMessage(): AssistantMessage {
	return {
		id: crypto.randomUUID(),
		role: 'assistant',
		content: '',
		timestamp: new Date(),
	}
}

function processQueuedMessages(state: ChatState): ChatState {
	if (state.queuedMessages.length === 0) {
		return state
	}

	return {
		...state,
		messages: [...state.messages, ...state.queuedMessages],
		queuedMessages: [],
	}
}

function startGeneration(state: ChatState): ChatState {
	const assistantMessage = createAssistantMessage()

	return {
		...state,
		status: 'generating',
		messages: [...state.messages, assistantMessage],
		assistantMessageId: assistantMessage.id,
		toolBoundaryId: crypto.randomUUID(),
	}
}

function transitionToReady(state: ChatState): ChatState {
	// First process any queued messages
	const processedState = processQueuedMessages({
		...state,
		status: 'ready',
		assistantMessageId: undefined,
	})

	// If there are messages after processing queue, start generation
	if (
		processedState.queuedMessages.length === 0 &&
		processedState.messages.length > 0
	) {
		// Check if the last message is from user or tool (indicating we need to generate a response)
		const lastMessage =
			processedState.messages[processedState.messages.length - 1]
		if (lastMessage.role === 'user' || lastMessage.role === 'tool') {
			return startGeneration(processedState)
		}
	}

	return processedState
}

function createToolMessage(toolCall: {
	id: string
	name: string
	arguments: Record<string, any>
	result?: string
}): ToolMessage {
	return {
		id: crypto.randomUUID(),
		role: 'tool',
		content: toolCall.result || '',
		timestamp: new Date(),
		toolCall,
	}
}

function detectToolCallInBuffer(
	buffer: string,
	toolBoundaryId: string,
): {
	toolCall: { name: string; arguments: Record<string, any> } | null
	remainingBuffer: string
} {
	if (!toolBoundaryId) {
		return { toolCall: null, remainingBuffer: buffer }
	}

	const toolCall = parseToolCall(buffer, toolBoundaryId)
	if (toolCall) {
		// Find where the tool call ends to get remaining buffer
		const toolCallRegex = new RegExp(
			`\\[TOOL_CALL:${toolBoundaryId}\\](.*?)\\[\\/TOOL_CALL:${toolBoundaryId}\\]`,
			's',
		)
		const match = buffer.match(toolCallRegex)
		if (match) {
			const remainingBuffer = buffer.slice(match.index! + match[0].length)
			return { toolCall, remainingBuffer }
		}
	}

	return { toolCall: null, remainingBuffer: buffer }
}

function extractContentBeforeToolCall(content: string): {
	beforeToolCall: string
	toolCallPart: string
} {
	const toolCallIndex = content.indexOf('[TOOL_CALL:')
	if (toolCallIndex === -1) {
		return { beforeToolCall: content, toolCallPart: '' }
	}
	return {
		beforeToolCall: content.slice(0, toolCallIndex),
		toolCallPart: content.slice(toolCallIndex),
	}
}

function shouldStartBuffering(
	content: string,
	existingBuffer: string = '',
): boolean {
	const combined = existingBuffer + content
	const toolCallStart = '[TOOL_CALL:'

	// Check if we're building up to a tool call
	for (let i = 1; i <= Math.min(combined.length, toolCallStart.length); i++) {
		if (toolCallStart.startsWith(combined.slice(-i))) {
			return true
		}
	}

	return false
}

function isValidToolCallBuffer(buffer: string): boolean {
	const toolCallStart = '[TOOL_CALL:'

	// If buffer is shorter than the start pattern, check if it's a valid prefix
	if (buffer.length <= toolCallStart.length) {
		return toolCallStart.startsWith(buffer)
	}

	// If buffer is longer, it should start with the pattern
	if (!buffer.startsWith(toolCallStart)) {
		return false
	}

	// Check if the content after [TOOL_CALL: looks like a valid tool call
	const afterStart = buffer.substring(toolCallStart.length)

	// If it contains patterns that clearly indicate natural language, it's not a tool call
	// Be more specific to avoid rejecting valid UUIDs
	if (/\s+[a-z]{3,}/.test(afterStart) || /[.!?]/.test(afterStart)) {
		return false
	}

	return true
}

// Logging system
const logLevels = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
} as const

type LogLevel = keyof typeof logLevels

const eventLogLevels = {
	LOAD_MODEL: 'info',
	MODEL_LOAD_PROGRESS: 'debug',
	MODEL_LOAD_SUCCESS: 'info',
	MODEL_LOAD_ERROR: 'error',
	ADD_MESSAGE: 'info',
	START_GENERATION: 'info',
	STREAM_CHUNK: 'debug',
	GENERATION_COMPLETE: 'info',
	GENERATION_ERROR: 'error',
	CLEAR_ERROR: 'info',
	PENDING_TOOL_CALL: 'info',

	TOOL_EXECUTION_SUCCESS: 'info',
	TOOL_EXECUTION_ERROR: 'error',
	TOOL_EXECUTION_TIMEOUT: 'warn',
	APPROVE_TOOL_REQUEST: 'info',
	REJECT_TOOL_REQUEST: 'info',
	SET_STATUS: 'info',
} satisfies Record<ChatAction['type'], LogLevel>

function logReducerEvent(
	action: ChatAction,
	beforeState: ChatState,
	afterState: ChatState,
	logLevel: LogLevel,
) {
	const eventLevel = eventLogLevels[action.type]
	if (!eventLevel) return

	if (logLevels[eventLevel] >= logLevels[logLevel]) {
		const logFn =
			eventLevel === 'debug'
				? 'log'
				: eventLevel === 'info'
					? 'log'
					: eventLevel
		console.group(`🔄 Action: ${action.type}`)
		console[logFn]('Action:', action)
		console[logFn]('Before:', beforeState)
		console[logFn]('After:', afterState)
		console.groupEnd()
	}
}

function withLogging(
	reducer: (state: ChatState, action: ChatAction) => ChatState,
) {
	return (state: ChatState, action: ChatAction): ChatState => {
		const afterState = reducer(state, action)
		logReducerEvent(action, state, afterState, state.logLevel || 'silent')
		return afterState
	}
}

function chatReducerImpl(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case 'LOAD_MODEL':
			return {
				...state,
				status: 'loadingModel',
				currentModelId: action.payload.modelId,
				modelLoadProgress: {
					status: 'pending',
					value: 0,
				},
				lastError: undefined,
			}

		case 'MODEL_LOAD_PROGRESS':
			return {
				...state,
				modelLoadProgress: {
					status: 'pending',
					value: action.payload.progress,
				},
			}

		case 'MODEL_LOAD_SUCCESS': {
			const processedState = processQueuedMessages({
				...state,
				status: 'ready',
				engine: action.payload.engine,
				modelLoadProgress: {
					status: 'success',
					value: 1,
				},
				lastError: undefined,
			})

			// If there are messages after processing queue, start generation
			if (
				processedState.messages.length > 0 &&
				processedState.status === 'ready'
			) {
				return startGeneration(processedState)
			}

			return processedState
		}

		case 'MODEL_LOAD_ERROR':
			return {
				...state,
				status: 'idle',
				modelLoadProgress: {
					status: 'error',
					value: 0,
				},
				lastError: {
					cause: 'Model Load Error',
					message: action.payload.error.message,
					stack: action.payload.error.stack,
				},
			}

		case 'ADD_MESSAGE': {
			const userMessage = createUserMessage(action.payload.content)

			if (state.status === 'loadingModel') {
				// Queue message while loading
				return {
					...state,
					queuedMessages: [...state.queuedMessages, userMessage],
				}
			}

			if (state.status === 'ready') {
				// Process any queued messages first, then add new message and start generation
				const processedState = processQueuedMessages(state)
				return startGeneration({
					...processedState,
					messages: [...processedState.messages, userMessage],
				})
			}

			// For other states, just queue the message
			return {
				...state,
				queuedMessages: [...state.queuedMessages, userMessage],
			}
		}

		case 'START_GENERATION':
			return startGeneration(state)

		case 'STREAM_CHUNK': {
			const assistantMessage = state.messages.find(
				(msg) => msg.id === state.assistantMessageId,
			)

			if (!assistantMessage) {
				throw new Error('Assistant message not found')
			}

			const chunk = action.payload.chunk
			const currentBuffer = state.streamBuffer || ''

			// If we're not currently buffering
			if (!currentBuffer) {
				// Check if this chunk contains the start of a tool call
				const { beforeToolCall, toolCallPart } =
					extractContentBeforeToolCall(chunk)

				if (toolCallPart) {
					// Check if this chunk contains a complete tool call
					if (state.toolBoundaryId) {
						const { toolCall, remainingBuffer } = detectToolCallInBuffer(
							toolCallPart,
							state.toolBoundaryId,
						)

						if (toolCall) {
							// Found a complete tool call in a single chunk
							return {
								...state,
								status: 'awaitingToolApproval',
								pendingToolCall: toolCall,
								bufferedToolContent: toolCallPart.slice(
									0,
									toolCallPart.length - remainingBuffer.length,
								),
								streamBuffer: undefined,
								messages: state.messages.map((msg) =>
									msg.id === state.assistantMessageId
										? {
												...msg,
												content: msg.content + beforeToolCall + remainingBuffer,
											}
										: msg,
								),
							}
						}
					}

					// Start buffering the tool call part
					return {
						...state,
						streamBuffer: toolCallPart,
						messages: state.messages.map((msg) =>
							msg.id === state.assistantMessageId
								? { ...msg, content: msg.content + beforeToolCall }
								: msg,
						),
					}
				}

				// Check if this chunk should start buffering (single character case)
				if (shouldStartBuffering(chunk)) {
					return {
						...state,
						streamBuffer: chunk,
					}
				}

				// Normal streaming - add chunk to message content
				return {
					...state,
					messages: state.messages.map((msg) =>
						msg.id === state.assistantMessageId
							? { ...msg, content: msg.content + chunk }
							: msg,
					),
				}
			}

			// We're currently buffering - add chunk to buffer
			const newBuffer = currentBuffer + chunk

			// Check if the buffer is still a valid tool call prefix
			if (!isValidToolCallBuffer(newBuffer)) {
				// Not a valid tool call, flush buffer + chunk to content
				return {
					...state,
					streamBuffer: undefined,
					messages: state.messages.map((msg) =>
						msg.id === state.assistantMessageId
							? { ...msg, content: msg.content + newBuffer }
							: msg,
					),
				}
			}

			// Check if we have a complete tool call in the buffer
			if (state.toolBoundaryId) {
				const { toolCall, remainingBuffer } = detectToolCallInBuffer(
					newBuffer,
					state.toolBoundaryId,
				)

				if (toolCall) {
					// Found a complete tool call - handle directly without recursive call
					const bufferedContent = newBuffer.slice(
						0,
						newBuffer.length - remainingBuffer.length,
					)

					// Create tool call request
					const requestId = crypto.randomUUID()
					const toolCallRequest: ToolCallRequest = {
						id: requestId,
						assistantMessageId: state.assistantMessageId!,
						toolCall,
						bufferedContent,
						status: 'pending',
					}

					return {
						...state,
						status: 'awaitingToolApproval',
						pendingToolCall: toolCall,
						bufferedToolContent: bufferedContent,
						currentToolRequestId: requestId,
						streamBuffer: undefined,
						toolCallRequests: {
							...state.toolCallRequests,
							[requestId]: toolCallRequest,
						},
						messages: state.messages.map((msg) =>
							msg.id === state.assistantMessageId
								? { ...msg, content: msg.content + remainingBuffer }
								: msg,
						),
					}
				}
			}

			// Continue buffering - but check if buffer is getting too long for a valid tool call
			if (newBuffer.length > 500) {
				// Buffer too long, probably not a tool call
				return {
					...state,
					streamBuffer: undefined,
					messages: state.messages.map((msg) =>
						msg.id === state.assistantMessageId
							? { ...msg, content: msg.content + newBuffer }
							: msg,
					),
				}
			}

			// Continue buffering
			return {
				...state,
				streamBuffer: newBuffer,
			}
		}

		case 'GENERATION_COMPLETE':
			return transitionToReady(state)

		case 'GENERATION_ERROR':
			return {
				...transitionToReady(state),
				lastError: {
					cause: 'Generation Error',
					message: action.payload.error.message,
					stack: action.payload.error.stack,
				},
			}

		case 'CLEAR_ERROR':
			return {
				...state,
				lastError: undefined,
			}

		case 'PENDING_TOOL_CALL': {
			const requestId = crypto.randomUUID()
			const toolCallRequest: ToolCallRequest = {
				id: requestId,
				assistantMessageId: state.assistantMessageId!,
				toolCall: action.payload.toolCall,
				bufferedContent: action.payload.bufferedContent,
				status: 'pending',
			}

			return {
				...state,
				status: 'awaitingToolApproval',
				pendingToolCall: action.payload.toolCall,
				bufferedToolContent: action.payload.bufferedContent,
				currentToolRequestId: requestId,
				toolCallRequests: {
					...state.toolCallRequests,
					[requestId]: toolCallRequest,
				},
			}
		}

		case 'TOOL_EXECUTION_SUCCESS': {
			const toolMessage = createToolMessage(action.payload.toolCall)
			const newAssistantMessage = createAssistantMessage()

			// Update the tool call request status
			const updatedRequests = state.currentToolRequestId
				? {
						...state.toolCallRequests,
						[state.currentToolRequestId]: {
							...state.toolCallRequests[state.currentToolRequestId],
							status: 'completed' as const,
							result: action.payload.toolCall.result,
						},
					}
				: state.toolCallRequests

			return {
				...state,
				status: 'generating',
				messages: [...state.messages, toolMessage, newAssistantMessage],
				assistantMessageId: newAssistantMessage.id,
				currentToolRequestId: undefined,
				toolCallRequests: updatedRequests,
			}
		}

		case 'TOOL_EXECUTION_ERROR': {
			const errorToolCall = {
				...action.payload.toolCall,
				result: `Error: ${action.payload.error.message}`,
			}
			const toolMessage = createToolMessage(errorToolCall)
			const newAssistantMessage = createAssistantMessage()

			// Update the tool call request status
			const updatedRequests = state.currentToolRequestId
				? {
						...state.toolCallRequests,
						[state.currentToolRequestId]: {
							...state.toolCallRequests[state.currentToolRequestId],
							status: 'error' as const,
							error: action.payload.error.message,
						},
					}
				: state.toolCallRequests

			return {
				...state,
				status: 'generating',
				messages: [...state.messages, toolMessage, newAssistantMessage],
				assistantMessageId: newAssistantMessage.id,
				currentToolRequestId: undefined,
				toolCallRequests: updatedRequests,
			}
		}

		case 'TOOL_EXECUTION_TIMEOUT': {
			if (!state.pendingToolCall) {
				return state
			}

			const timeoutToolCall = {
				...state.pendingToolCall,
				id: crypto.randomUUID(),
				result: 'Error: Tool execution timed out',
			}
			const toolMessage = createToolMessage(timeoutToolCall)
			const newAssistantMessage = createAssistantMessage()

			return {
				...state,
				status: 'generating',
				messages: [...state.messages, toolMessage, newAssistantMessage],
				assistantMessageId: newAssistantMessage.id,
				pendingToolCall: undefined,
				bufferedToolContent: undefined,
			}
		}

		case 'APPROVE_TOOL_REQUEST': {
			const request = state.toolCallRequests[action.payload.requestId]
			if (!request) {
				return state
			}

			return {
				...state,
				status: 'executingTool',
				pendingToolCall: request.toolCall,
				currentToolRequestId: action.payload.requestId,
				toolCallRequests: {
					...state.toolCallRequests,
					[action.payload.requestId]: {
						...request,
						status: 'executing',
					},
				},
			}
		}

		case 'REJECT_TOOL_REQUEST': {
			const request = state.toolCallRequests[action.payload.requestId]
			if (!request) {
				return state
			}

			return {
				...state,
				status: 'generating',
				toolCallRequests: {
					...state.toolCallRequests,
					[action.payload.requestId]: {
						...request,
						status: 'rejected',
					},
				},
			}
		}

		case 'SET_STATUS':
			return {
				...state,
				status: action.payload.status,
			}

		default:
			return state
	}
}

export const chatReducer = withLogging(chatReducerImpl)
