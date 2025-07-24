import { expect, test, describe, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChat } from './use-chat'
import { chatReducer, initialChatState, type ChatState } from './chat-reducer'
import { consoleLog } from '#tests/test-setup'

// Mock web-llm module
vi.mock('@mlc-ai/web-llm', () => ({
	CreateMLCEngine: vi.fn(),
}))

// Mock search engine
vi.mock('./search-engine', () => ({
	search: vi.fn().mockResolvedValue([]),
}))

// Mock tools
vi.mock('./tools', () => ({
	invokeTool: vi.fn().mockResolvedValue('Mock tool result'),
}))

describe('useChat integration', () => {
	test('reducer should handle basic state transitions', () => {
		let state = initialChatState

		// Load model
		state = chatReducer(state, {
			type: 'LOAD_MODEL',
			payload: { modelId: 'test-model' },
		})
		expect(state.status).toBe('loadingModel')
		expect(state.currentModelId).toBe('test-model')

		// Add message while loading (should queue)
		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Hello' },
		})
		expect(state.queuedMessages).toHaveLength(1)
		expect(state.queuedMessages[0].content).toBe('Hello')

		// Model load success (should process queue and start generation)
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})
		expect(state.status).toBe('ready')
		expect(state.messages).toHaveLength(1) // only user message, no assistant yet
		expect(state.queuedMessages).toHaveLength(0)

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })
		expect(state.status).toBe('generating')
		expect(state.messages).toHaveLength(2) // user + assistant

		// Stream chunks
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: 'Hello' },
		})
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: ' world' },
		})
		expect(state.messages[1].content).toBe('Hello world')

		// Complete generation
		state = chatReducer(state, {
			type: 'GENERATION_COMPLETE',
		})
		expect(state.status).toBe('ready')
	})

	test('reducer should handle errors correctly', () => {
		let state = initialChatState

		// Load model
		state = chatReducer(state, {
			type: 'LOAD_MODEL',
			payload: { modelId: 'test-model' },
		})

		// Model load error
		const error = new Error('Load failed')
		state = chatReducer(state, {
			type: 'MODEL_LOAD_ERROR',
			payload: { error },
		})
		expect(state.status).toBe('idle')
		expect(state.lastError).toEqual({
			cause: 'Model Load Error',
			message: 'Load failed',
			stack: error.stack,
		})

		// Clear error
		state = chatReducer(state, {
			type: 'CLEAR_ERROR',
		})
		expect(state.lastError).toBeUndefined()
	})

	test('should detect and buffer tool calls during streaming', () => {
		let state = initialChatState

		// Set up ready state with engine
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		// Add message to start generation
		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Search for information' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// Stream chunks that build up to a tool call
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: 'I need to search for that. ' },
		})
		expect(state.messages[1].content).toBe('I need to search for that. ')

		// Start streaming a tool call
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: '[TOOL_CALL:' },
		})
		// Should start buffering
		expect(state.messages[1].content).toBe('I need to search for that. ')
		expect(state.streamBuffer).toBe('[TOOL_CALL:')

		// Continue building the tool call
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: {
				chunk: `${state.toolBoundaryId}]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:${state.toolBoundaryId}]`,
			},
		})

		// Should detect complete tool call and transition to awaiting approval
		expect(state.status).toBe('awaitingToolApproval')
		expect(state.pendingToolCall).toEqual({
			name: 'search',
			arguments: { query: 'test' },
		})
		expect(state.messages[1].content).toBe('I need to search for that. ')
		expect(state.streamBuffer).toBeUndefined()
	})

	test('should handle partial tool calls that are not complete', () => {
		let state = initialChatState

		// Set up generating state
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Test' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// Stream partial tool call that never completes
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: 'I need to [TOOL_CALL:' },
		})
		expect(state.streamBuffer).toBe('[TOOL_CALL:')
		expect(state.messages[1].content).toBe('I need to ')

		// Stream more content that makes it clear it's not a tool call
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: 'make a call to the API directly.' },
		})

		// Should flush buffer to content
		expect(state.messages[1].content).toBe(
			'I need to [TOOL_CALL:make a call to the API directly.',
		)
		expect(state.streamBuffer).toBeUndefined()
	})

	test('should detect complete tool calls in a single chunk', () => {
		let state = initialChatState

		// Set up generating state
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Test API' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// Stream a complete tool call in a single chunk (like the bug report)
		const toolBoundaryId = state.toolBoundaryId!
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: {
				chunk: `I'll test that API for you.\n\n[TOOL_CALL:${toolBoundaryId}]\n{"name": "test-api", "arguments": {"url": "https://example.com/api", "method": "GET", "headers": "{}", "body": ""}}\n[/TOOL_CALL:${toolBoundaryId}]`,
			},
		})

		// Should detect the complete tool call and transition to awaiting approval
		expect(state.status).toBe('awaitingToolApproval')
		expect(state.pendingToolCall).toEqual({
			name: 'test-api',
			arguments: {
				url: 'https://example.com/api',
				method: 'GET',
				headers: '{}',
				body: '',
			},
		})
		expect(state.messages[1].content).toBe("I'll test that API for you.\n\n")
		expect(state.streamBuffer).toBeUndefined()
	})

	test('should reproduce the exact bug from user report', () => {
		let state = initialChatState

		// Set up generating state
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: {
				content: 'Hey, can you test my API https://example.com/api-tester',
			},
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// Stream the exact content from the user's bug report
		const toolBoundaryId = state.toolBoundaryId!
		const exactContent = `[TOOL_CALL:${toolBoundaryId}]\n{"name": "test-api", "arguments": {"url": "https://example.com/api-tester", "method": "GET", "headers": "{}", "body": ""}}\n[/TOOL_CALL:${toolBoundaryId}]\n\nThis will test the API endpoint and validate the response. Please note that I'm assuming a GET method, if you'd like to test with a different method (e.g. POST, PUT, DELETE), please let me know and I'll adjust the parameters accordingly.`

		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: exactContent },
		})

		// BUG: Currently this fails because the tool call appears in content instead of being detected
		expect(state.status).toBe('awaitingToolApproval')
		expect(state.pendingToolCall).toEqual({
			name: 'test-api',
			arguments: {
				url: 'https://example.com/api-tester',
				method: 'GET',
				headers: '{}',
				body: '',
			},
		})
		expect(state.messages[1].content).toBe(
			"\n\nThis will test the API endpoint and validate the response. Please note that I'm assuming a GET method, if you'd like to test with a different method (e.g. POST, PUT, DELETE), please let me know and I'll adjust the parameters accordingly.",
		)
		expect(state.streamBuffer).toBeUndefined()
	})

	test('should handle tool call spread across multiple chunks', () => {
		consoleLog.mockImplementation(() => {})

		let state = initialChatState

		// Set up generating state
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Test API' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		const toolBoundaryId = state.toolBoundaryId!

		// Test with two chunks - this should work with current implementation
		const chunk1 = `[TOOL_CALL:${toolBoundaryId}]\n{"name": "test-api", "arguments": {"url": "https://example.com/api", "method": "GET", "headers": "{}", "body": ""}}\n[/TOOL_CALL:${toolBoundaryId}]`
		const chunk2 = '\n\nThis will test the API.'

		// Stream first chunk with complete tool call
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: chunk1 },
		})

		// Should detect the complete tool call and transition to awaiting approval
		expect(state.status).toBe('awaitingToolApproval')
		expect(state.pendingToolCall).toEqual({
			name: 'test-api',
			arguments: {
				url: 'https://example.com/api',
				method: 'GET',
				headers: '{}',
				body: '',
			},
		})

		// Stream remaining content
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: chunk2 },
		})

		// Should still be awaiting approval
		expect(state.status).toBe('awaitingToolApproval')
		expect(state.messages[1].content).toBe(chunk2)
		expect(state.streamBuffer).toBeUndefined()
	})

	test('should handle tool execution and continue conversation', () => {
		let state = initialChatState

		// Set up ready state with engine
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		// Add message to start generation
		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Search for information' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// Simulate a complete tool call being detected
		state = chatReducer(state, {
			type: 'PENDING_TOOL_CALL',
			payload: {
				toolCall: {
					name: 'search',
					arguments: { query: 'test' },
				},
				bufferedContent:
					'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
			},
		})

		expect(state.status).toBe('awaitingToolApproval')
		expect(state.pendingToolCall).toEqual({
			name: 'search',
			arguments: { query: 'test' },
		})

		// Approve the tool call (get the actual request ID)
		const requestId = Object.keys(state.toolCallRequests)[0]
		state = chatReducer(state, {
			type: 'APPROVE_TOOL_REQUEST',
			payload: { requestId },
		})

		expect(state.status).toBe('executingTool')
		expect(state.pendingToolCall).toBeUndefined()

		// Tool execution succeeds
		state = chatReducer(state, {
			type: 'TOOL_EXECUTION_SUCCESS',
			payload: {
				toolCall: {
					id: 'tool-1',
					name: 'search',
					arguments: { query: 'test' },
					result: 'Search results found',
				},
			},
		})

		expect(state.status).toBe('generating')
		expect(state.messages).toHaveLength(4) // user + assistant + tool + new assistant
		expect(state.messages[2]).toMatchObject({
			role: 'tool',
			content: 'Search results found',
		})
		expect(state.messages[3]).toMatchObject({
			role: 'assistant',
			content: '',
		})
	})

	test('should handle tool execution errors gracefully', () => {
		let state = initialChatState

		// Set up executing tool state
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Test' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// First create a pending tool call
		state = chatReducer(state, {
			type: 'PENDING_TOOL_CALL',
			payload: {
				toolCall: {
					name: 'search',
					arguments: { query: 'test' },
				},
				bufferedContent:
					'[TOOL_CALL:123]{"name": "search", "arguments": {"query": "test"}}[/TOOL_CALL:123]',
			},
		})

		// Transition to executing tool (get the actual request ID)
		const requestId = Object.keys(state.toolCallRequests)[0]
		state = chatReducer(state, {
			type: 'APPROVE_TOOL_REQUEST',
			payload: { requestId },
		})

		// Tool execution fails
		state = chatReducer(state, {
			type: 'TOOL_EXECUTION_ERROR',
			payload: {
				toolCall: {
					id: 'tool-1',
					name: 'search',
					arguments: { query: 'test' },
				},
				error: new Error('Tool execution failed'),
			},
		})

		expect(state.status).toBe('generating')
		expect(state.messages).toHaveLength(4) // user + assistant + tool error + new assistant
		expect(state.messages[2]).toMatchObject({
			role: 'tool',
			content: 'Error: Tool execution failed',
		})
		expect(state.messages[3]).toMatchObject({
			role: 'assistant',
			content: '',
		})
	})

	test('should debug tool execution getting stuck', () => {
		consoleLog.mockImplementation(() => {})

		let state: ChatState = { ...initialChatState, logLevel: 'debug' as const }

		// Set up ready state with engine
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		// Add message to start generation
		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'What is the weather in Highland, Utah?' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		expect(state.status).toBe('generating')
		expect(state.messages).toHaveLength(2) // user + assistant

		// Simulate a pending tool call directly (like other tests)
		state = chatReducer(state, {
			type: 'PENDING_TOOL_CALL',
			payload: {
				toolCall: {
					name: 'weather',
					arguments: { location: 'Highland, Utah', units: 'fahrenheit' },
				},
				bufferedContent: `[TOOL_CALL:${state.toolBoundaryId}]{"name": "weather", "arguments": {"location": "Highland, Utah", "units": "fahrenheit"}}[/TOOL_CALL:${state.toolBoundaryId}]`,
			},
		})

		expect(state.status).toBe('awaitingToolApproval')
		expect(state.pendingToolCall).toEqual({
			name: 'weather',
			arguments: { location: 'Highland, Utah', units: 'fahrenheit' },
		})

		// Manually approve tool call (simulating user approval)
		const requestIds = Object.keys(state.toolCallRequests)
		if (requestIds.length === 0) {
			throw new Error('No tool call requests found')
		}
		const requestId = requestIds[0]

		state = chatReducer(state, {
			type: 'APPROVE_TOOL_REQUEST',
			payload: { requestId },
		})

		expect(state.status).toBe('executingTool')
		console.log('Final state:', state)
	})
})
