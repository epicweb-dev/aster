import { expect, test, describe, beforeEach, vi } from 'vitest'
import {
	chatReducer,
	initialChatState,
	type ChatState,
	type ChatAction,
} from './chat-reducer'

// Mock web-llm module
vi.mock('@mlc-ai/web-llm', () => ({
	CreateMLCEngine: vi.fn(),
}))

describe('chatReducer', () => {
	let state: ChatState

	beforeEach(() => {
		state = initialChatState
	})

	describe('LOAD_MODEL', () => {
		test('should set loading state and model id', () => {
			const action: ChatAction = {
				type: 'LOAD_MODEL',
				payload: { modelId: 'test-model' },
			}

			const newState = chatReducer(state, action)

			expect(newState.status).toBe('loadingModel')
			expect(newState.currentModelId).toBe('test-model')
			expect(newState.modelLoadProgress).toEqual({
				status: 'pending',
				value: 0,
			})
			expect(newState.lastError).toBeUndefined()
		})
	})

	describe('MODEL_LOAD_PROGRESS', () => {
		test('should update progress while loading', () => {
			const loadingState = chatReducer(state, {
				type: 'LOAD_MODEL',
				payload: { modelId: 'test-model' },
			})

			const action: ChatAction = {
				type: 'MODEL_LOAD_PROGRESS',
				payload: { progress: 0.5 },
			}

			const newState = chatReducer(loadingState, action)

			expect(newState.modelLoadProgress).toEqual({
				status: 'pending',
				value: 0.5,
			})
		})
	})

	describe('MODEL_LOAD_SUCCESS', () => {
		test('should set ready state and process queued messages', () => {
			const loadingState: ChatState = {
				...state,
				status: 'loadingModel',
				currentModelId: 'test-model',
				queuedMessages: [
					{
						id: '1',
						role: 'user',
						content: 'Hello',
						timestamp: new Date(),
					},
				],
			}

			const mockEngine = { mock: 'engine' } as any
			const action: ChatAction = {
				type: 'MODEL_LOAD_SUCCESS',
				payload: { engine: mockEngine },
			}

			const newState = chatReducer(loadingState, action)

			// When there are queued messages, it should process them and set status to ready
			expect(newState.status).toBe('ready')
			expect(newState.engine).toBe(mockEngine)
			expect(newState.modelLoadProgress).toEqual({
				status: 'success',
				value: 1,
			})
			expect(newState.messages).toHaveLength(1) // only user message, no assistant message created yet
			expect(newState.messages[0]).toMatchObject({
				role: 'user',
				content: 'Hello',
			})
			expect(newState.queuedMessages).toHaveLength(0)
			expect(newState.lastError).toBeUndefined()
		})

		test('should set ready state when no queued messages', () => {
			const loadingState: ChatState = {
				...state,
				status: 'loadingModel',
				currentModelId: 'test-model',
				queuedMessages: [],
			}

			const mockEngine = { mock: 'engine' } as any
			const action: ChatAction = {
				type: 'MODEL_LOAD_SUCCESS',
				payload: { engine: mockEngine },
			}

			const newState = chatReducer(loadingState, action)

			expect(newState.status).toBe('ready')
			expect(newState.engine).toBe(mockEngine)
			expect(newState.modelLoadProgress).toEqual({
				status: 'success',
				value: 1,
			})
			expect(newState.messages).toHaveLength(0)
			expect(newState.queuedMessages).toHaveLength(0)
			expect(newState.lastError).toBeUndefined()
		})
	})

	describe('MODEL_LOAD_ERROR', () => {
		test('should set error state and clear progress', () => {
			const loadingState = chatReducer(state, {
				type: 'LOAD_MODEL',
				payload: { modelId: 'test-model' },
			})

			const error = new Error('Load failed')
			const action: ChatAction = {
				type: 'MODEL_LOAD_ERROR',
				payload: { error },
			}

			const newState = chatReducer(loadingState, action)

			expect(newState.status).toBe('idle')
			expect(newState.modelLoadProgress).toEqual({
				status: 'error',
				value: 0,
			})
			expect(newState.lastError).toEqual({
				cause: 'Model Load Error',
				message: 'Load failed',
				stack: error.stack,
			})
		})
	})

	describe('ADD_MESSAGE', () => {
		test('should queue message when model is loading', () => {
			const loadingState = chatReducer(state, {
				type: 'LOAD_MODEL',
				payload: { modelId: 'test-model' },
			})

			const action: ChatAction = {
				type: 'ADD_MESSAGE',
				payload: { content: 'Hello world' },
			}

			const newState = chatReducer(loadingState, action)

			expect(newState.queuedMessages).toHaveLength(1)
			expect(newState.queuedMessages[0]).toMatchObject({
				role: 'user',
				content: 'Hello world',
				id: expect.any(String),
				timestamp: expect.any(Date),
			})
		})

		test('should add message and start generation when ready', () => {
			const readyState: ChatState = {
				...state,
				status: 'ready',
				engine: { mock: 'engine' } as any,
			}

			const action: ChatAction = {
				type: 'ADD_MESSAGE',
				payload: { content: 'Hello world' },
			}

			const newState = chatReducer(readyState, action)

			expect(newState.status).toBe('ready')
			expect(newState.messages).toHaveLength(1) // only user message, no assistant message created yet
			expect(newState.messages[0]).toMatchObject({
				role: 'user',
				content: 'Hello world',
			})
			expect(newState.assistantMessageId).toBeUndefined()
		})
	})

	describe('START_GENERATION', () => {
		test('should create assistant message and set generating state', () => {
			const readyState: ChatState = {
				...state,
				status: 'ready',
				engine: { mock: 'engine' } as any,
				messages: [
					{
						id: '1',
						role: 'user',
						content: 'Hello',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'START_GENERATION',
			}

			const newState = chatReducer(readyState, action)

			expect(newState.status).toBe('generating')
			expect(newState.messages).toHaveLength(2)
			expect(newState.messages[1]).toMatchObject({
				role: 'assistant',
				content: '',
				id: expect.any(String),
			})
			expect(newState.assistantMessageId).toBe(newState.messages[1].id)
		})
	})

	describe('STREAM_CHUNK', () => {
		test('should append chunk to assistant message', () => {
			const generatingState: ChatState = {
				...state,
				status: 'generating',
				assistantMessageId: 'assistant-1',
				messages: [
					{
						id: 'user-1',
						role: 'user',
						content: 'Hello',
						timestamp: new Date(),
					},
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'Hi',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'STREAM_CHUNK',
				payload: { chunk: ' there!' },
			}

			const newState = chatReducer(generatingState, action)

			expect(newState.messages[1].content).toBe('Hi there!')
		})

		test('should handle missing assistant message gracefully', () => {
			const generatingState: ChatState = {
				...state,
				status: 'generating',
				assistantMessageId: 'missing-id',
				messages: [],
			}

			const action: ChatAction = {
				type: 'STREAM_CHUNK',
				payload: { chunk: 'chunk' },
			}

			expect(() => chatReducer(generatingState, action)).toThrow(
				'Assistant message not found',
			)
		})
	})

	describe('GENERATION_COMPLETE', () => {
		test('should return to ready state', () => {
			const generatingState: ChatState = {
				...state,
				status: 'generating',
				assistantMessageId: 'assistant-1',
				messages: [
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'Complete response',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'GENERATION_COMPLETE',
			}

			const newState = chatReducer(generatingState, action)

			expect(newState.status).toBe('ready')
			expect(newState.assistantMessageId).toBeUndefined()
		})
	})

	describe('GENERATION_ERROR', () => {
		test('should return to ready state with error', () => {
			const generatingState: ChatState = {
				...state,
				status: 'generating',
				assistantMessageId: 'assistant-1',
			}

			const error = new Error('Generation failed')
			const action: ChatAction = {
				type: 'GENERATION_ERROR',
				payload: { error },
			}

			const newState = chatReducer(generatingState, action)

			expect(newState.status).toBe('ready')
			expect(newState.assistantMessageId).toBeUndefined()
			expect(newState.lastError).toEqual({
				cause: 'Generation Error',
				message: 'Generation failed',
				stack: error.stack,
			})
		})
	})

	describe('CLEAR_ERROR', () => {
		test('should clear last error', () => {
			const errorState: ChatState = {
				...state,
				lastError: {
					cause: 'Test Error',
					message: 'Test message',
					stack: 'stack trace',
				},
			}

			const action: ChatAction = {
				type: 'CLEAR_ERROR',
			}

			const newState = chatReducer(errorState, action)

			expect(newState.lastError).toBeUndefined()
		})
	})

	describe('Queue Processing Bug Fixes', () => {
		test('should process queued messages when adding message to ready state', () => {
			const readyStateWithQueue: ChatState = {
				...state,
				status: 'ready',
				engine: { mock: 'engine' } as any,
				queuedMessages: [
					{
						id: '1',
						role: 'user',
						content: 'Queued message',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'ADD_MESSAGE',
				payload: { content: 'New message' },
			}

			const newState = chatReducer(readyStateWithQueue, action)

			expect(newState.status).toBe('ready')
			expect(newState.queuedMessages).toHaveLength(0)
			expect(newState.messages).toHaveLength(2) // queued + new, no assistant message yet
			expect(newState.messages[0]).toMatchObject({
				role: 'user',
				content: 'Queued message',
			})
			expect(newState.messages[1]).toMatchObject({
				role: 'user',
				content: 'New message',
			})
		})

		test('should process queued messages and start generation after GENERATION_COMPLETE', () => {
			const generatingStateWithQueue: ChatState = {
				...state,
				status: 'generating',
				assistantMessageId: 'assistant-1',
				messages: [
					{
						id: 'user-1',
						role: 'user',
						content: 'First message',
						timestamp: new Date(),
					},
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'Response',
						timestamp: new Date(),
					},
				],
				queuedMessages: [
					{
						id: '2',
						role: 'user',
						content: 'Queued message',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'GENERATION_COMPLETE',
			}

			const newState = chatReducer(generatingStateWithQueue, action)

			expect(newState.status).toBe('ready') // Should return to ready, let calling code trigger generation
			expect(newState.queuedMessages).toHaveLength(0)
			expect(newState.messages).toHaveLength(3) // original 2 + queued, no new assistant message yet
			expect(newState.messages[2]).toMatchObject({
				role: 'user',
				content: 'Queued message',
			})
			expect(newState.assistantMessageId).toBeUndefined()
		})

		test('should return to ready state when no queued messages after GENERATION_COMPLETE', () => {
			const generatingState: ChatState = {
				...state,
				status: 'generating',
				assistantMessageId: 'assistant-1',
				messages: [
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'Complete response',
						timestamp: new Date(),
					},
				],
				queuedMessages: [],
			}

			const action: ChatAction = {
				type: 'GENERATION_COMPLETE',
			}

			const newState = chatReducer(generatingState, action)

			expect(newState.status).toBe('ready')
			expect(newState.assistantMessageId).toBeUndefined()
			expect(newState.queuedMessages).toHaveLength(0)
		})
	})
})

describe('Tool Call Functionality', () => {
	describe('PENDING_TOOL_CALL', () => {
		test('should store pending tool call and prevent output', () => {
			const generatingState: ChatState = {
				...initialChatState,
				status: 'generating',
				assistantMessageId: 'assistant-1',
				messages: [
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'I need to call a tool: ',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'PENDING_TOOL_CALL',
				payload: {
					toolCall: {
						name: 'search',
						arguments: { query: 'test' },
					},
					bufferedContent:
						'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
				},
			}

			const newState = chatReducer(generatingState, action)

			expect(newState.pendingToolCall).toEqual({
				name: 'search',
				arguments: { query: 'test' },
			})
			expect(newState.bufferedToolContent).toBe(
				'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
			)
			expect(newState.status).toBe('awaitingToolApproval')
			// Content should not include the tool call
			expect(newState.messages[0].content).toBe('I need to call a tool: ')
		})
	})

	describe('APPROVE_TOOL_REQUEST', () => {
		test('should approve tool request and set executing status', () => {
			const stateWithToolRequest: ChatState = {
				...initialChatState,
				status: 'awaitingToolApproval',
				assistantMessageId: 'assistant-1',
				currentToolRequestId: 'request-123',
				toolCallRequests: {
					'request-123': {
						id: 'request-123',
						assistantMessageId: 'assistant-1',
						toolCall: { name: 'search', arguments: { query: 'test' } },
						bufferedContent:
							'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
						status: 'pending',
					},
				},
				pendingToolCall: {
					name: 'search',
					arguments: { query: 'test' },
				},
				bufferedToolContent:
					'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
			}

			const action: ChatAction = {
				type: 'APPROVE_TOOL_REQUEST',
				payload: { requestId: 'request-123' },
			}

			const newState = chatReducer(stateWithToolRequest, action)

			expect(newState.status).toBe('executingTool')
			expect(newState.toolCallRequests['request-123'].status).toBe('executing')
		})
	})

	describe('REJECT_TOOL_REQUEST', () => {
		test('should reject tool request and return to generating', () => {
			const stateWithToolRequest: ChatState = {
				...initialChatState,
				status: 'awaitingToolApproval',
				assistantMessageId: 'assistant-1',
				currentToolRequestId: 'request-123',
				toolCallRequests: {
					'request-123': {
						id: 'request-123',
						assistantMessageId: 'assistant-1',
						toolCall: { name: 'search', arguments: { query: 'test' } },
						bufferedContent:
							'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
						status: 'pending',
					},
				},
				messages: [
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'I need to search for information.',
						timestamp: new Date(),
					},
				],
				pendingToolCall: {
					name: 'search',
					arguments: { query: 'test' },
				},
				bufferedToolContent:
					'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
			}

			const action: ChatAction = {
				type: 'REJECT_TOOL_REQUEST',
				payload: { requestId: 'request-123' },
			}

			const newState = chatReducer(stateWithToolRequest, action)

			expect(newState.status).toBe('generating')
			expect(newState.pendingToolCall).toBeUndefined()
			expect(newState.bufferedToolContent).toBeUndefined()
			expect(newState.toolCallRequests['request-123'].status).toBe('rejected')
			// Should add the buffered content back to the message
			expect(newState.messages[0].content).toBe(
				'I need to search for information.[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
			)
		})
	})

	describe('TOOL_EXECUTION_SUCCESS', () => {
		test('should add tool result message and start new generation', () => {
			const executingState: ChatState = {
				...initialChatState,
				status: 'executingTool',
				assistantMessageId: 'assistant-1',
				messages: [
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'I need to search for information.',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'TOOL_EXECUTION_SUCCESS',
				payload: {
					toolCall: {
						id: 'tool-1',
						name: 'search',
						arguments: { query: 'test' },
						result: 'Search results found',
					},
				},
			}

			const newState = chatReducer(executingState, action)

			expect(newState.status).toBe('generating')
			expect(newState.messages).toHaveLength(3)
			expect(newState.messages[1]).toMatchObject({
				role: 'tool',
				content: 'Search results found',
				toolCall: {
					id: 'tool-1',
					name: 'search',
					arguments: { query: 'test' },
					result: 'Search results found',
				},
			})
			// Should create new assistant message
			expect(newState.messages[2]).toMatchObject({
				role: 'assistant',
				content: '',
			})
			expect(newState.assistantMessageId).toBe(newState.messages[2].id)
		})
	})

	describe('TOOL_EXECUTION_ERROR', () => {
		test('should add tool error message and start new generation', () => {
			const executingState: ChatState = {
				...initialChatState,
				status: 'executingTool',
				assistantMessageId: 'assistant-1',
				messages: [
					{
						id: 'assistant-1',
						role: 'assistant',
						content: 'I need to search for information.',
						timestamp: new Date(),
					},
				],
			}

			const action: ChatAction = {
				type: 'TOOL_EXECUTION_ERROR',
				payload: {
					toolCall: {
						id: 'tool-1',
						name: 'search',
						arguments: { query: 'test' },
					},
					error: new Error('Tool execution failed'),
				},
			}

			const newState = chatReducer(executingState, action)

			expect(newState.status).toBe('generating')
			expect(newState.messages).toHaveLength(3)
			expect(newState.messages[1]).toMatchObject({
				role: 'tool',
				content: 'Error: Tool execution failed',
				toolCall: {
					id: 'tool-1',
					name: 'search',
					arguments: { query: 'test' },
				},
			})
			// Should create new assistant message
			expect(newState.messages[2]).toMatchObject({
				role: 'assistant',
				content: '',
			})
			expect(newState.assistantMessageId).toBe(newState.messages[2].id)
		})
	})
})
