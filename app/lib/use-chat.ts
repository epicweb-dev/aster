import { useReducer, useEffect, useRef, useCallback } from 'react'
import type { MLCEngine, ChatCompletionMessageParam } from '@mlc-ai/web-llm'
import {
	chatReducer,
	initialChatState,
	type ChatState,
	type ChatAction,
} from './chat-reducer'
import { search } from './search-engine'
import { getErrorMessage } from './utils'
import { invokeTool } from './tools'

export function useChat() {
	const [state, dispatch] = useReducer(chatReducer, initialChatState)
	const engineRef = useRef<MLCEngine | undefined>(undefined)
	const abortControllerRef = useRef<AbortController | undefined>(undefined)

	// Handle model loading
	const loadModel = useCallback(async (modelId: string) => {
		try {
			dispatch({ type: 'LOAD_MODEL', payload: { modelId } })

			const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

			// Create engine with progress callback
			const engine = await CreateMLCEngine(modelId, {
				initProgressCallback: (progress) => {
					dispatch({
						type: 'MODEL_LOAD_PROGRESS',
						payload: { progress: progress.progress },
					})
				},
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

	// Handle tool execution
	useEffect(() => {
		if (state.status !== 'executingTool' || !state.pendingToolCall) {
			return
		}

		const executeTool = async () => {
			try {
				const toolCall = state.pendingToolCall!
				const result = await invokeTool(toolCall.name, toolCall.arguments)

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
			} catch (error) {
				dispatch({
					type: 'TOOL_EXECUTION_ERROR',
					payload: {
						toolCall: {
							id: crypto.randomUUID(),
							name: state.pendingToolCall!.name,
							arguments: state.pendingToolCall!.arguments,
						},
						error: error instanceof Error ? error : new Error(String(error)),
					},
				})
			}
		}

		executeTool()
	}, [state.status, state.pendingToolCall])

	// Handle message generation
	useEffect(() => {
		if (state.status !== 'generating' || !state.engine) {
			return
		}

		const generateResponse = async () => {
			try {
				// Cancel any previous generation
				if (abortControllerRef.current) {
					abortControllerRef.current.abort()
				}

				abortControllerRef.current = new AbortController()
				const signal = abortControllerRef.current.signal

				// Convert messages to the format expected by the engine
				const messages: Array<ChatCompletionMessageParam> = state.messages
					.filter(
						(msg) => msg.role !== 'assistant' || msg.content.trim() !== '',
					)
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

				// Search for relevant tools
				const searchResults = await search(messagesForCompletion)
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

${tools.map((tool) => tool.llmDescription).join('\n')}

To call a tool, use this exact format:
[TOOL_CALL:${state.toolBoundaryId}]
{"name": "tool_name", "arguments": {"arg1": "value1"}}
[/TOOL_CALL:${state.toolBoundaryId}]

Only call tools when necessary to help the user.`,
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
				if (!state.engine) {
					throw new Error('Engine not available for generation')
				}

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
		}

		generateResponse()

		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort()
			}
		}
	}, [state.status, state.engine])

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

	const addMessage = useCallback((content: string) => {
		dispatch({ type: 'ADD_MESSAGE', payload: { content } })
	}, [])

	const clearError = useCallback(() => {
		dispatch({ type: 'CLEAR_ERROR' })
	}, [])

	const approveToolCall = useCallback(() => {
		dispatch({ type: 'APPROVE_TOOL_CALL' })
	}, [])

	const rejectToolCall = useCallback(() => {
		dispatch({ type: 'REJECT_TOOL_CALL' })
	}, [])

	return {
		state,
		loadModel,
		addMessage,
		clearError,
		approveToolCall,
		rejectToolCall,
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
