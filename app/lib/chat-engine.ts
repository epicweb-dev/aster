import {
	type ChatCompletionMessageParam,
	type ChatCompletionTool,
} from '@mlc-ai/web-llm'

// Lazy initialization for chat worker
let chatWorker: Worker | null = null
let isInitializing = false

export async function getChatWorker() {
	if (chatWorker || isInitializing) return chatWorker

	isInitializing = true

	try {
		// Create Web Worker for chat functionality
		chatWorker = new Worker(new URL('./chat-worker.ts', import.meta.url), {
			type: 'module',
		})

		return chatWorker
	} catch (error) {
		console.error('Failed to create chat worker:', error)
		throw error
	} finally {
		isInitializing = false
	}
}

export async function* chatStream(
	messages: Array<ChatCompletionMessageParam>,
	tools?: Array<ChatCompletionTool>,
): AsyncGenerator<{ content: string; done: boolean }> {
	try {
		const worker = await getChatWorker()
		if (!worker) {
			console.warn('Chat worker not available, returning no response')
			return
		}

		const chatId = crypto.randomUUID()
		let isComplete = false
		let finalResult: any = null
		const chunkQueue: Array<{ content: string; done: boolean }> = []
		let resolveNext:
			| ((value: { content: string; done: boolean }) => void)
			| null = null
		let rejectNext: ((error: Error) => void) | null = null

		// Track pending tool executions
		const pendingToolExecutions = new Map<string, Promise<any>>()
		const toolResults: Array<{ toolCall: any; result: any }> = []

		const handleMessage = (event: MessageEvent) => {
			if (event.data.id !== chatId && !event.data.id?.startsWith('tool-'))
				return

			if (event.data.type === 'chat-chunk') {
				const chunk = event.data.chunk
				if (resolveNext) {
					resolveNext(chunk)
					resolveNext = null
					rejectNext = null
				} else {
					chunkQueue.push(chunk)
				}
			} else if (event.data.type === 'chat-result') {
				finalResult = event.data.response

				// Check if there are tool calls to execute
				if (finalResult.toolCalls && finalResult.toolCalls.length > 0) {
					// Execute each tool call
					for (const toolCall of finalResult.toolCalls) {
						const toolId = `tool-${crypto.randomUUID()}`

						const toolPromise = new Promise<any>((resolve, reject) => {
							const toolHandler = (toolEvent: MessageEvent) => {
								if (toolEvent.data.id !== toolId) return

								if (toolEvent.data.type === 'tool-result') {
									worker.removeEventListener('message', toolHandler)
									resolve(toolEvent.data.result)
								} else if (toolEvent.data.type === 'tool-error') {
									worker.removeEventListener('message', toolHandler)
									reject(new Error(toolEvent.data.error))
								}
							}

							worker.addEventListener('message', toolHandler)

							// Send execute-tool message
							worker.postMessage({
								type: 'execute-tool',
								id: toolId,
								toolCall,
							})

							// Set timeout for tool execution
							setTimeout(() => {
								worker.removeEventListener('message', toolHandler)
								reject(new Error('Tool execution timeout'))
							}, 30000)
						})

						pendingToolExecutions.set(toolId, toolPromise)
					}

					// Wait for all tool executions to complete
					Promise.allSettled(Array.from(pendingToolExecutions.values())).then(
						(results) => {
							results.forEach((result, index) => {
								const toolCall = finalResult.toolCalls[index]
								if (result.status === 'fulfilled') {
									toolResults.push({ toolCall, result: result.value })
								} else {
									toolResults.push({
										toolCall,
										result: {
											error: result.reason?.message || 'Tool execution failed',
										},
									})
								}
							})

							// Mark as complete after tool executions
							isComplete = true
							if (resolveNext) {
								resolveNext({ content: '', done: true })
								resolveNext = null
								rejectNext = null
							}
						},
					)
				} else {
					// No tool calls, mark as complete immediately
					isComplete = true
					if (resolveNext) {
						resolveNext({ content: '', done: true })
						resolveNext = null
						rejectNext = null
					}
				}
			} else if (event.data.type === 'chat-error') {
				worker.removeEventListener('message', handleMessage)
				if (rejectNext) {
					rejectNext(new Error(event.data.error))
					resolveNext = null
					rejectNext = null
				}
			}
		}

		worker.addEventListener('message', handleMessage)

		// Send chat request to worker
		worker.postMessage({
			type: 'chat',
			id: chatId,
			messages,
			tools,
		})

		// Set a timeout to prevent hanging
		const timeoutId = setTimeout(() => {
			worker.removeEventListener('message', handleMessage)
			if (rejectNext) {
				rejectNext(new Error('Chat timeout'))
				resolveNext = null
				rejectNext = null
			}
		}, 60000) // Longer timeout for chat responses

		try {
			// Yield chunks as they come in
			while (!isComplete) {
				if (chunkQueue.length > 0) {
					yield chunkQueue.shift()!
				} else {
					// Wait for next chunk
					const nextChunk = await new Promise<{
						content: string
						done: boolean
					}>((resolve, reject) => {
						resolveNext = resolve
						rejectNext = reject
					})
					yield nextChunk
				}
			}

			// Yield tool results if any
			for (const { toolCall, result } of toolResults) {
				const toolResultContent = `[TOOL_RESULT:${toolCall.id}]${JSON.stringify(
					{
						name: toolCall.function.name,
						arguments: JSON.parse(toolCall.function.arguments),
						result: result.error ? { error: result.error } : result,
					},
				)}[/TOOL_RESULT:${toolCall.id}]`

				yield { content: toolResultContent, done: false }
			}

			// Generator is complete
		} finally {
			clearTimeout(timeoutId)
			worker.removeEventListener('message', handleMessage)
		}
	} catch (error) {
		console.error('Chat failed:', error)
		throw error
	}
}
