import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'
import { invokeTool } from './tools.js'

const handler = new WebWorkerMLCEngineHandler()

// Lazy initialization for web-llm engine
let engine: any = null
let isInitializing = false

async function initializeEngine() {
	if (engine || isInitializing) return engine

	isInitializing = true

	try {
		const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

		// Create the engine
		engine = await CreateMLCEngine('Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC')

		return engine
	} catch (error) {
		console.error('Failed to initialize web-llm engine:', error)
		throw error
	} finally {
		isInitializing = false
	}
}

async function performChat(
	messages: Array<any>,
	tools?: Array<any>,
	chatId?: string,
): Promise<{
	content: string | null
	toolCalls?: Array<{
		id: string
		type: 'function'
		function: {
			name: string
			arguments: string
		}
	}>
}> {
	try {
		// Initialize the engine if needed
		const llmEngine = await initializeEngine()
		if (!llmEngine) {
			console.warn('Web-LLM engine not available, returning no response')
			return {
				content: 'Sorry, the chat engine is not available at the moment.',
			}
		}

		// Prepare the chat completion request
		const chatRequest: any = {
			messages,
			temperature: 0.7,
			max_tokens: 2000,
			stream: true, // Enable streaming
		}

		// Add tools if provided
		if (tools && tools.length > 0) {
			chatRequest.tools = tools
			chatRequest.tool_choice = 'auto'
		}

		console.log('performing chat with the following request:', {
			messages: messages.length,
			tools: tools?.length || 0,
		})

		// Send the chat request to the LLM and handle streaming
		const response = await llmEngine.chat.completions.create(chatRequest)
		console.log('chat performed, got streaming response:', response)

		let fullContent = ''
		let toolCalls: Array<{
			id: string
			type: 'function'
			function: {
				name: string
				arguments: string
			}
		}> = []

		// Process streaming chunks
		for await (const chunk of response) {
			const choice = chunk.choices[0]
			if (!choice) continue

			const delta = choice.delta
			if (!delta) continue

			// Handle content streaming
			if (delta.content) {
				fullContent += delta.content
				// Send streaming chunk to main thread
				if (chatId) {
					self.postMessage({
						type: 'chat-chunk',
						id: chatId,
						chunk: {
							content: delta.content,
							done: false,
						},
					})
				}
			}

			// Handle tool calls streaming
			if (delta.tool_calls && delta.tool_calls.length > 0) {
				for (const toolCall of delta.tool_calls) {
					const existingIndex = toolCalls.findIndex(
						(tc) => tc.id === toolCall.id,
					)

					if (existingIndex >= 0) {
						// Update existing tool call
						if (toolCall.function?.name) {
							toolCalls[existingIndex].function.name = toolCall.function.name
						}
						if (toolCall.function?.arguments) {
							toolCalls[existingIndex].function.arguments +=
								toolCall.function.arguments
						}
					} else {
						// Create new tool call
						toolCalls.push({
							id: toolCall.id,
							type: toolCall.type,
							function: {
								name: toolCall.function?.name || '',
								arguments: toolCall.function?.arguments || '',
							},
						})
					}
				}
			}
		}

		// Send final result
		const finalResult = {
			content: fullContent,
			...(toolCalls.length > 0 && { toolCalls }),
		}

		return finalResult
	} catch (error) {
		console.error('Chat failed:', error)
		return {
			content: 'Sorry, an error occurred while processing your request.',
		}
	}
}

async function executeToolCall(toolCall: {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}): Promise<any> {
	try {
		const { name, arguments: argsString } = toolCall.function
		const args = JSON.parse(argsString)

		console.log('executing tool call:', { name, args })

		const result = await invokeTool(name, args)

		console.log('tool execution result:', result)

		return result
	} catch (error) {
		console.error('Tool execution failed:', error)
		throw error
	}
}

self.onmessage = async (msg: MessageEvent) => {
	console.log('worker received message:', msg.data)
	// Handle MLCEngine messages
	if (msg.data.type === 'mlc-engine') {
		handler.onmessage(msg)
		return
	}

	// Handle chat messages
	if (msg.data.type === 'chat') {
		try {
			const response = await performChat(
				msg.data.messages,
				msg.data.tools,
				msg.data.id,
			)
			self.postMessage({
				type: 'chat-result',
				id: msg.data.id,
				response,
			})
		} catch (error) {
			self.postMessage({
				type: 'chat-error',
				id: msg.data.id,
				error: error instanceof Error ? error.message : String(error),
			})
		}
		return
	}

	// Handle tool execution messages
	if (msg.data.type === 'execute-tool') {
		try {
			const result = await executeToolCall(msg.data.toolCall)
			self.postMessage({
				type: 'tool-result',
				id: msg.data.id,
				result,
			})
		} catch (error) {
			self.postMessage({
				type: 'tool-error',
				id: msg.data.id,
				error: error instanceof Error ? error.message : String(error),
			})
		}
		return
	}
}
