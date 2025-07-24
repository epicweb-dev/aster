import { expect, test, describe, vi } from 'vitest'
import { chatReducer, initialChatState } from './chat-reducer'
import { consoleLog } from '#tests/test-setup'

// Mock tools
vi.mock('./tools', () => ({
	invokeTool: vi.fn().mockImplementation((name: string, args: any) => {
		if (name === 'search') {
			return Promise.resolve(`Search results for: ${args.query}`)
		}
		if (name === 'calculate') {
			return Promise.resolve({ result: 42, expression: args.expression })
		}
		return Promise.resolve('Mock result')
	}),
}))

describe('Tool Call Integration', () => {
	test('complete tool call workflow from streaming to execution', async () => {
		consoleLog.mockImplementation(() => {})

		let state = initialChatState

		// Set up ready state with engine
		const mockEngine = { mock: 'engine' } as any
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: mockEngine },
		})

		// Add user message
		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Please search for information about React hooks' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		expect(state.status).toBe('generating')
		expect(state.messages).toHaveLength(2) // user + assistant

		// Simulate streaming response that includes a tool call
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: 'I can help you search for that information. ' },
		})

		expect(state.messages[1].content).toBe(
			'I can help you search for that information. ',
		)

		// Stream a complete tool call in one chunk
		const toolBoundaryId = state.toolBoundaryId!
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: {
				chunk: `[TOOL_CALL:${toolBoundaryId}]{"name": "search", "arguments": {"query": "React hooks"}}[/TOOL_CALL:${toolBoundaryId}]`,
			},
		})

		// Should transition to awaiting approval
		expect(state.status).toBe('awaitingToolApproval')
		expect(state.pendingToolCall).toEqual({
			name: 'search',
			arguments: { query: 'React hooks' },
		})
		expect(state.streamBuffer).toBeUndefined()

		// User approves the tool call (using old system for this test)
		state = chatReducer(state, {
			type: 'PENDING_TOOL_CALL',
			payload: {
				toolCall: { name: 'search', arguments: { query: 'React hooks' } },
				bufferedContent: `[TOOL_CALL:${toolBoundaryId}]{"name": "search", "arguments": {"query": "React hooks"}}[/TOOL_CALL:${toolBoundaryId}]`,
			},
		})

		// Get the request ID from the created tool call request
		const requestId = Object.keys(state.toolCallRequests)[0]
		state = chatReducer(state, {
			type: 'APPROVE_TOOL_REQUEST',
			payload: { requestId },
		})

		expect(state.status).toBe('executingTool')

		// Tool execution succeeds
		state = chatReducer(state, {
			type: 'TOOL_EXECUTION_SUCCESS',
			payload: {
				toolCall: {
					id: 'tool-1',
					name: 'search',
					arguments: { query: 'React hooks' },
					result: 'Search results for: React hooks',
				},
			},
		})

		// Should be back to generating with tool result added
		expect(state.status).toBe('generating')
		expect(state.messages).toHaveLength(4) // user + assistant + tool + new assistant

		expect(state.messages[2]).toMatchObject({
			role: 'tool',
			content: 'Search results for: React hooks',
			toolCall: {
				id: 'tool-1',
				name: 'search',
				arguments: { query: 'React hooks' },
				result: 'Search results for: React hooks',
			},
		})

		// New assistant message for continuation
		expect(state.messages[3]).toMatchObject({
			role: 'assistant',
			content: '',
		})

		// Continue streaming the assistant's response
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: { chunk: 'Based on the search results, ' },
		})

		expect(state.messages[3].content).toBe('Based on the search results, ')

		// Complete the response
		state = chatReducer(state, {
			type: 'STREAM_CHUNK',
			payload: {
				chunk:
					'React hooks are functions that let you use state and other React features.',
			},
		})

		expect(state.messages[3].content).toBe(
			'Based on the search results, React hooks are functions that let you use state and other React features.',
		)

		// Mark generation complete
		state = chatReducer(state, {
			type: 'GENERATION_COMPLETE',
		})

		expect(state.status).toBe('ready')
	})

	test('tool call rejection workflow', () => {
		let state = initialChatState

		// Set up state with pending tool call
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: { mock: 'engine' } as any },
		})

		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Calculate something' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// Simulate pending tool call
		state = chatReducer(state, {
			type: 'PENDING_TOOL_CALL',
			payload: {
				toolCall: {
					name: 'calculate',
					arguments: { expression: '2 + 2' },
				},
				bufferedContent:
					'[TOOL_CALL:123]{"name": "calculate", "arguments": {"expression": "2 + 2"}}[/TOOL_CALL:123]',
			},
		})

		expect(state.status).toBe('awaitingToolApproval')

		// User rejects the tool call
		const rejectionRequestId = Object.keys(state.toolCallRequests)[0]
		state = chatReducer(state, {
			type: 'REJECT_TOOL_REQUEST',
			payload: { requestId: rejectionRequestId },
		})

		// Should return to generating and add buffered content back
		expect(state.status).toBe('generating')
		expect(state.pendingToolCall).toBeUndefined()
		expect(state.messages[1].content).toBe(
			'[TOOL_CALL:123]{"name": "calculate", "arguments": {"expression": "2 + 2"}}[/TOOL_CALL:123]',
		)
	})

	test('multiple tool calls in sequence', () => {
		let state = initialChatState

		// Set up ready state
		state = chatReducer(state, {
			type: 'MODEL_LOAD_SUCCESS',
			payload: { engine: { mock: 'engine' } as any },
		})

		state = chatReducer(state, {
			type: 'ADD_MESSAGE',
			payload: { content: 'Search and calculate' },
		})

		// Start generation (creates assistant message)
		state = chatReducer(state, { type: 'START_GENERATION' })

		// First tool call - search
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

		// Get the request ID from the created tool call request
		const requestId1 = Object.keys(state.toolCallRequests)[0]
		state = chatReducer(state, {
			type: 'APPROVE_TOOL_REQUEST',
			payload: { requestId: requestId1 },
		})

		state = chatReducer(state, {
			type: 'TOOL_EXECUTION_SUCCESS',
			payload: {
				toolCall: {
					id: 'tool-1',
					name: 'search',
					arguments: { query: 'test' },
					result: 'Search results',
				},
			},
		})

		// Should have 4 messages: user + assistant + tool + new assistant
		expect(state.messages).toHaveLength(4)
		expect(state.status).toBe('generating')

		// Second tool call - calculate
		state = chatReducer(state, {
			type: 'PENDING_TOOL_CALL',
			payload: {
				toolCall: {
					name: 'calculate',
					arguments: { expression: '5 * 5' },
				},
				bufferedContent:
					'[TOOL_CALL:124]{"name": "calculate", "arguments": {"expression": "5 * 5"}}[/TOOL_CALL:124]',
			},
		})

		// Get the request ID from the created tool call request (second one)
		const requestIds = Object.keys(state.toolCallRequests)
		const requestId2 = requestIds[requestIds.length - 1] // Get the latest request
		state = chatReducer(state, {
			type: 'APPROVE_TOOL_REQUEST',
			payload: { requestId: requestId2 },
		})

		state = chatReducer(state, {
			type: 'TOOL_EXECUTION_SUCCESS',
			payload: {
				toolCall: {
					id: 'tool-2',
					name: 'calculate',
					arguments: { expression: '5 * 5' },
					result: '25',
				},
			},
		})

		// Should have 6 messages: user + assistant + tool1 + assistant + tool2 + new assistant
		expect(state.messages).toHaveLength(6)
		expect(state.messages[4]).toMatchObject({
			role: 'tool',
			content: '25',
		})
	})
})
