import { type Message, type ToolSet, formatDataStreamPart } from 'ai'

// Confirmation constants shared between frontend and backend
export const APPROVAL = {
	YES: 'Yes, confirmed.',
	NO: 'No, denied.',
} as const

type ProcessToolCallsParams<T extends ToolSet> = {
	messages: Message[]
	dataStream: { write: (chunk: any) => void }
	tools: T
}

type ExecuteFunction<T extends ToolSet> = {
	[K in keyof T]: T[K] extends { execute: undefined }
		? (args: any) => Promise<string>
		: never
}

export async function processToolCalls<T extends ToolSet>(
	{ messages, dataStream, tools }: ProcessToolCallsParams<T>,
	executeFunction: Partial<ExecuteFunction<T>>,
): Promise<Message[]> {
	if (messages.length === 0) return messages

	const lastMessage = messages[messages.length - 1]
	if (!lastMessage.parts) return messages

	const processedParts = await Promise.all(
		lastMessage.parts.map(async (part) => {
			if (part.type !== 'tool-invocation') return part

			const toolInvocation = part.toolInvocation
			const toolName = toolInvocation.toolName as keyof T

			// Skip if tool has an execute function (no confirmation needed)
			if (typeof tools[toolName]?.execute === 'function') {
				return part
			}

			// Check if this tool requires confirmation and has a result
			if (toolInvocation.state === 'result' && toolInvocation.result) {
				let result: string

				if (toolInvocation.result === APPROVAL.YES) {
					// Execute the tool function
					const executeFn = executeFunction[toolName]
					if (executeFn) {
						result = await executeFn(toolInvocation.args)
					} else {
						result = 'Error: No execute function found for tool'
					}
				} else if (toolInvocation.result === APPROVAL.NO) {
					result = 'Error: User denied access to tool execution'
				} else {
					// For any unhandled responses, return the original part
					return part
				}

				// Forward updated tool result to the client
				dataStream.write(
					formatDataStreamPart('tool_result', {
						toolCallId: toolInvocation.toolCallId,
						result,
					}),
				)

				// Return updated toolInvocation with the actual result
				return {
					...part,
					toolInvocation: {
						...toolInvocation,
						result,
					},
				}
			}

			return part
		}),
	)

	// Finally return the processed messages
	return [...messages.slice(0, -1), { ...lastMessage, parts: processedParts }]
}

export function getToolsRequiringConfirmation<T extends ToolSet>(
	tools: T,
): string[] {
	return (Object.keys(tools) as (keyof T)[]).filter((key) => {
		const maybeTool = tools[key]
		return typeof maybeTool.execute !== 'function'
	}) as string[]
}
