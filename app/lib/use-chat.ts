import { useReducer, useEffect, useRef, useCallback } from 'react'
import type {
	WebWorkerMLCEngine,
	ChatCompletionMessageParam,
} from '@mlc-ai/web-llm'
import { chatReducer, initialChatState } from './chat-reducer'
import { search } from './search-engine'
import { invokeTool } from './tools'

export function useChat() {
	const [state, dispatch] = useReducer(chatReducer, initialChatState)
	const engineRef = useRef<WebWorkerMLCEngine | undefined>(undefined)
	const abortControllerRef = useRef<AbortController | undefined>(undefined)

	// Handle model loading
	const loadModel = useCallback(async (modelId: string) => {
		try {
			dispatch({ type: 'LOAD_MODEL', payload: { modelId } })

			const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')

			// Create Web Worker for heavy computation
			const worker = new Worker(new URL('./worker.ts', import.meta.url), {
				type: 'module',
			})

			// Create engine with Web Worker and IndexedDB caching
			const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
				initProgressCallback: (progress) => {
					dispatch({
						type: 'MODEL_LOAD_PROGRESS',
						payload: { progress: progress.progress },
					})
				},
				// TODO: figure out what to put in model_list
				// appConfig: {
				// 	useIndexedDBCache: true,
				// 	model_list: [],
				// },
			})

			engineRef.current = engine
			dispatch({ type: 'MODEL_LOAD_SUCCESS', payload: { engine } })
		} catch (error) {
			dispatch({
				type: 'MODEL_LOAD_ERROR',
				payload: {
					error: error instanceof Error ? error : new Error(String(error)),
				},
			})
		}
	}, [])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (engineRef.current) {
				engineRef.current.unload()
			}
			if (abortControllerRef.current) {
				abortControllerRef.current.abort()
			}
		}
	}, [])

	// Direct workflow functions (replacing useEffects)
	const executeTool = useCallback(
		async (toolCall: { name: string; arguments: any }) => {
			const timeoutId = setTimeout(() => {
				dispatch({ type: 'TOOL_EXECUTION_TIMEOUT' })
			}, 30000)

			try {
				const result = await invokeTool(toolCall.name, toolCall.arguments)

				clearTimeout(timeoutId)
				dispatch({
					type: 'TOOL_EXECUTION_SUCCESS',
					payload: {
						toolCall: {
							id: crypto.randomUUID(),
							name: toolCall.name,
							arguments: toolCall.arguments,
							result:
								typeof result === 'string' ? result : JSON.stringify(result),
						},
					},
				})

				// Continue generation after successful tool execution
				setTimeout(() => generateResponse(), 0)
			} catch (error) {
				clearTimeout(timeoutId)
				dispatch({
					type: 'TOOL_EXECUTION_ERROR',
					payload: {
						toolCall: {
							id: crypto.randomUUID(),
							name: toolCall.name,
							arguments: toolCall.arguments,
						},
						error: error instanceof Error ? error : new Error(String(error)),
					},
				})
			}
		},
		[],
	)

	const generateResponse = useCallback(async () => {
		if (!state.engine) {
			return
		}

		try {
			// Cancel any previous generation
			if (abortControllerRef.current) {
				abortControllerRef.current.abort()
			}

			abortControllerRef.current = new AbortController()
			const signal = abortControllerRef.current.signal

			// Convert messages to the format expected by the engine
			const messages: Array<ChatCompletionMessageParam> = state.messages
				.filter((msg) => msg.role !== 'assistant' || msg.content.trim() !== '')
				.map((msg) => {
					if (msg.role === 'tool') {
						return {
							role: 'tool' as const,
							content: msg.content,
							tool_call_id: msg.toolCall?.id,
						}
					}
					return {
						role: msg.role as 'user' | 'assistant' | 'system',
						content: msg.content,
					}
				})

			// Remove the empty assistant message from the end for completion
			const messagesForCompletion =
				removeMessagesAfterLastUserOrToolMessage(messages)

			// Update status to searching
			dispatch({ type: 'SET_STATUS', payload: { status: 'searching' } })

			// Search for relevant tools
			const searchResults = await search(messagesForCompletion)

			// Update status to generating for streaming
			dispatch({ type: 'SET_STATUS', payload: { status: 'generating' } })

			const tools = searchResults.map((tool) => ({
				id: tool.id,
				llmDescription: tool.llmDescription,
			}))

			// Prepare system message with tool instructions
			const systemMessages: Array<ChatCompletionMessageParam> = []
			if (tools.length > 0) {
				systemMessages.push({
					role: 'system',
					content: `You are a helpful assistant that can use tools to help the user. Below is a list of tools available:

${tools
	.map((tool) => `<tool id="${tool.id}">\n${tool.llmDescription}\n</tool>`)
	.join('\n\n')}

When you need to use a tool, format your response as: [TOOL_CALL:${state.toolBoundaryId}]{"name": "tool_name", "arguments": {"key": "value"}}[/TOOL_CALL:${state.toolBoundaryId}]

Important: Only use the exact tool names and argument structures shown above.`,
				})
			} else {
				systemMessages.push({
					role: 'system',
					content:
						'You are a helpful AI assistant. Be concise and friendly in your responses.',
				})
			}

			const allMessages = [...systemMessages, ...messagesForCompletion]

			// Create streaming chat completion
			const stream = await state.engine.chat.completions.create({
				messages: allMessages,
				stream: true,
				temperature: 0.7,
				max_tokens: 1000,
			})

			for await (const chunk of stream) {
				if (signal.aborted) {
					break
				}

				const content = chunk.choices[0]?.delta?.content || ''
				if (content) {
					dispatch({ type: 'STREAM_CHUNK', payload: { chunk: content } })
				}
			}

			if (!signal.aborted) {
				dispatch({ type: 'GENERATION_COMPLETE' })
			}
		} catch (error) {
			if (error instanceof Error && error.name !== 'AbortError') {
				dispatch({
					type: 'GENERATION_ERROR',
					payload: { error },
				})
			}
		}
	}, [state.engine, state.messages, state.toolBoundaryId])

	const addMessage = useCallback(
		(content: string) => {
			dispatch({ type: 'ADD_MESSAGE', payload: { content } })
			// Directly trigger generation workflow after adding message
			setTimeout(() => generateResponse(), 0)
		},
		[generateResponse],
	)

	const clearError = useCallback(() => {
		dispatch({ type: 'CLEAR_ERROR' })
	}, [])

	const approveToolRequest = useCallback(
		(requestId: string) => {
			dispatch({ type: 'APPROVE_TOOL_REQUEST', payload: { requestId } })
			// Directly trigger tool execution workflow after approval
			const toolCallRequest = state.toolCallRequests[requestId]
			if (toolCallRequest) {
				setTimeout(() => executeTool(toolCallRequest.toolCall), 0)
			}
		},
		[state.toolCallRequests, executeTool],
	)

	const rejectToolRequest = useCallback(
		(requestId: string) => {
			dispatch({ type: 'REJECT_TOOL_REQUEST', payload: { requestId } })
			// After rejection, continue generation if there are more messages to process
			setTimeout(() => {
				if (state.queuedMessages.length > 0) {
					generateResponse()
				}
			}, 0)
		},
		[state.queuedMessages, generateResponse],
	)

	return {
		state,
		loadModel,
		addMessage,
		clearError,
		approveToolRequest,
		rejectToolRequest,
	}
}

// Helper function to remove messages after the last user or tool message
function removeMessagesAfterLastUserOrToolMessage<
	MessageType extends { role: string },
>(messages: Array<MessageType>) {
	const lastUserOrToolMessage = messages.findLastIndex((msg) =>
		['user', 'tool'].includes(msg.role),
	)
	if (lastUserOrToolMessage === -1) {
		return messages
	}
	return messages.slice(0, lastUserOrToolMessage + 1)
}
