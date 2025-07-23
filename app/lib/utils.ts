export function getErrorMessage(
	error: unknown,
	defaultMessage: string = 'Unknown Error',
) {
	if (typeof error === 'string') return error
	if (
		error &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message
	}
	console.error('Unable to get error message for error', error)
	return defaultMessage
}

export function parseToolCall(content: string, toolBoundaryId: string) {
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
