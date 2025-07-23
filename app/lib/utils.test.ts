import { expect, test } from 'vitest'
import { getErrorMessage, parseToolCall } from './utils'
import { consoleError } from '#tests/test-setup'

test('getErrorMessage with string error', () => {
	const error = 'Test error message'
	const result = getErrorMessage(error)
	expect(result).toBe('Test error message')
})

test('getErrorMessage with Error object', () => {
	const error = new Error('Test error message')
	const result = getErrorMessage(error)
	expect(result).toBe('Test error message')
})

test('getErrorMessage with custom error object with message property', () => {
	const error = { message: 'Custom error message' }
	const result = getErrorMessage(error)
	expect(result).toBe('Custom error message')
})

test('getErrorMessage with non-string message property', () => {
	consoleError.mockImplementation(() => {})
	const error = { message: 123 }
	const result = getErrorMessage(error)
	expect(result).toBe('Unknown Error')
	expect(consoleError).toHaveBeenCalledTimes(1)
})

test('getErrorMessage with object without message property', () => {
	consoleError.mockImplementation(() => {})
	const error = { code: 'ERROR_CODE' }
	const result = getErrorMessage(error)
	expect(result).toBe('Unknown Error')
	expect(consoleError).toHaveBeenCalledTimes(1)
})

test('getErrorMessage with null', () => {
	consoleError.mockImplementation(() => {})
	const result = getErrorMessage(null)
	expect(result).toBe('Unknown Error')
	expect(consoleError).toHaveBeenCalledTimes(1)
})

test('getErrorMessage with undefined', () => {
	consoleError.mockImplementation(() => {})
	const result = getErrorMessage(undefined)
	expect(result).toBe('Unknown Error')
	expect(consoleError).toHaveBeenCalledTimes(1)
})

test('getErrorMessage with number', () => {
	consoleError.mockImplementation(() => {})
	const result = getErrorMessage(42)
	expect(result).toBe('Unknown Error')
	expect(consoleError).toHaveBeenCalledTimes(1)
})

test('getErrorMessage with custom default message', () => {
	consoleError.mockImplementation(() => {})
	const error = { code: 'ERROR_CODE' }
	const result = getErrorMessage(error, 'Custom default message')
	expect(result).toBe('Custom default message')
	expect(consoleError).toHaveBeenCalledTimes(1)
})

test('parseToolCall with valid tool call', () => {
	const toolBoundaryId = 'test-tool'
	const toolCallContent = {
		name: 'test-name',
		arguments: { param1: 'value1', param2: 'value2' },
	}
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]${JSON.stringify(
		toolCallContent,
	)}[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toStrictEqual({
		name: 'test-name',
		arguments: { param1: 'value1', param2: 'value2' },
	})
})

test('parseToolCall with tool call without arguments', () => {
	const toolBoundaryId = 'test-tool'
	const toolCallContent = { name: 'test-name' }
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]${JSON.stringify(
		toolCallContent,
	)}[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toStrictEqual({
		name: 'test-name',
		arguments: {},
	})
})

test('parseToolCall with tool call without name', () => {
	const toolBoundaryId = 'test-tool'
	const toolCallContent = { arguments: { param1: 'value1' } }
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]${JSON.stringify(
		toolCallContent,
	)}[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toBeNull()
})

test('parseToolCall with non-string name', () => {
	const toolBoundaryId = 'test-tool'
	const toolCallContent = { name: 123, arguments: { param1: 'value1' } }
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]${JSON.stringify(
		toolCallContent,
	)}[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toBeNull()
})

test('parseToolCall with invalid JSON', () => {
	consoleError.mockImplementation(() => {})
	const toolBoundaryId = 'test-tool'
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]{ invalid json }[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toBeNull()
	expect(consoleError).toHaveBeenCalledTimes(1)
})

test('parseToolCall with no tool call in content', () => {
	const toolBoundaryId = 'test-tool'
	const content = 'Some content without tool call'

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toBeNull()
})

test('parseToolCall with different tool boundary id', () => {
	const toolBoundaryId = 'different-tool'
	const toolCallContent = { name: 'test-name', arguments: { param1: 'value1' } }
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]${JSON.stringify(
		toolCallContent,
	)}[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toStrictEqual({
		name: 'test-name',
		arguments: { param1: 'value1' },
	})
})

test('parseToolCall with multiple tool calls returns first match', () => {
	const toolBoundaryId = 'test-tool'
	const toolCallContent1 = {
		name: 'first-name',
		arguments: { param1: 'value1' },
	}
	const toolCallContent2 = {
		name: 'second-name',
		arguments: { param2: 'value2' },
	}
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]${JSON.stringify(
		toolCallContent1,
	)}[/TOOL_CALL:${toolBoundaryId}] middle content [TOOL_CALL:${toolBoundaryId}]${JSON.stringify(
		toolCallContent2,
	)}[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toStrictEqual({
		name: 'first-name',
		arguments: { param1: 'value1' },
	})
})

test('parseToolCall with whitespace around tool call content', () => {
	const toolBoundaryId = 'test-tool'
	const toolCallContent = { name: 'test-name', arguments: { param1: 'value1' } }
	const content = `Some content [TOOL_CALL:${toolBoundaryId}]
		${JSON.stringify(toolCallContent)}
	[/TOOL_CALL:${toolBoundaryId}] more content`

	const result = parseToolCall(content, toolBoundaryId)

	expect(result).toStrictEqual({
		name: 'test-name',
		arguments: { param1: 'value1' },
	})
})
