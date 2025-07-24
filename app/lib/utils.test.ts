import { expect, test } from 'vitest'
import { getErrorMessage } from './utils'
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
