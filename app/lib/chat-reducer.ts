import type { MLCEngine } from '@mlc-ai/web-llm'
import { getErrorMessage, parseToolCall } from './utils'

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
			type: 'APPROVE_TOOL_CALL'
	  }
	| {
			type: 'REJECT_TOOL_CALL'
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

export const initialChatState: ChatState = {
	status: 'idle',
	currentModelId: undefined,
	modelLoadProgress: {
		status: 'idle',
		value: 0,
	},
	messages: [],
	queuedMessages: [],
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

function shouldBufferContent(
	content: string,
	existingBuffer: string = '',
): boolean {
	const combined = existingBuffer + content
	// Check if it looks like the start of a tool call but not a complete one
	return combined.includes('[TOOL_CALL:') && !combined.includes('[/TOOL_CALL:')
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

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
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

			// If we're not currently buffering, check if this chunk starts a tool call
			if (!currentBuffer) {
				const { beforeToolCall, toolCallPart } =
					extractContentBeforeToolCall(chunk)

				if (toolCallPart) {
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
				} else {
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
			}

			// We're currently buffering - add chunk to buffer
			const newBuffer = currentBuffer + chunk

			// Check if we have a complete tool call in the buffer
			if (state.toolBoundaryId) {
				const { toolCall, remainingBuffer } = detectToolCallInBuffer(
					newBuffer,
					state.toolBoundaryId,
				)

				if (toolCall) {
					// Found a complete tool call
					return {
						...state,
						status: 'awaitingToolApproval',
						pendingToolCall: toolCall,
						bufferedToolContent: newBuffer.slice(
							0,
							newBuffer.length - remainingBuffer.length,
						),
						streamBuffer: undefined,
						messages: state.messages.map((msg) =>
							msg.id === state.assistantMessageId
								? { ...msg, content: msg.content + remainingBuffer }
								: msg,
						),
					}
				}
			}

			// Check if it's clear this is not going to be a tool call
			const hasClosing = newBuffer.includes('[/TOOL_CALL:')

			// If we have a complete tool call, it would have been handled above
			// If we don't have closing and the buffer contains patterns that indicate it's not a tool call, flush it
			if (!hasClosing) {
				const afterToolCall = newBuffer.substring(
					newBuffer.indexOf('[TOOL_CALL:') + 11,
				)

				// Check for patterns that indicate this is not a real tool call:
				// 1. Contains spaces followed by lowercase words (natural language)
				// 2. Doesn't start with a proper boundary ID format
				// 3. Contains punctuation that wouldn't be in a tool call
				const hasNaturalLanguage = /\s+[a-z]+/.test(afterToolCall)
				const hasInvalidChars = /[.,!?]/.test(afterToolCall)
				const tooLong = afterToolCall.length > 100

				if (hasNaturalLanguage || hasInvalidChars || tooLong) {
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

		case 'PENDING_TOOL_CALL':
			return {
				...state,
				status: 'awaitingToolApproval',
				pendingToolCall: action.payload.toolCall,
				bufferedToolContent: action.payload.bufferedContent,
			}

		case 'APPROVE_TOOL_CALL':
			return {
				...state,
				status: 'executingTool',
				pendingToolCall: undefined,
				bufferedToolContent: undefined,
			}

		case 'REJECT_TOOL_CALL': {
			const bufferedContent = state.bufferedToolContent || ''
			return {
				...state,
				status: 'generating',
				pendingToolCall: undefined,
				bufferedToolContent: undefined,
				messages: state.messages.map((msg) =>
					msg.id === state.assistantMessageId
						? { ...msg, content: msg.content + bufferedContent }
						: msg,
				),
			}
		}

		case 'TOOL_EXECUTION_SUCCESS': {
			const toolMessage = createToolMessage(action.payload.toolCall)
			const newAssistantMessage = createAssistantMessage()

			return {
				...state,
				status: 'generating',
				messages: [...state.messages, toolMessage, newAssistantMessage],
				assistantMessageId: newAssistantMessage.id,
			}
		}

		case 'TOOL_EXECUTION_ERROR': {
			const errorToolCall = {
				...action.payload.toolCall,
				result: `Error: ${action.payload.error.message}`,
			}
			const toolMessage = createToolMessage(errorToolCall)
			const newAssistantMessage = createAssistantMessage()

			return {
				...state,
				status: 'generating',
				messages: [...state.messages, toolMessage, newAssistantMessage],
				assistantMessageId: newAssistantMessage.id,
			}
		}

		default:
			return state
	}
}
