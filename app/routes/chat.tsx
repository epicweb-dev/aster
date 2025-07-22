import { useState, useEffect, useRef } from 'react'
import type { Route } from './+types/chat'
import {
	CreateMLCEngine,
	prebuiltAppConfig,
	type MLCEngine,
	type InitProgressCallback,
	type ChatCompletionMessageParam,
} from '@mlc-ai/web-llm'
import {
	searchEngine,
	registerDefaultTools,
	type ToolDefinition,
	SearchEngine,
} from '../lib/search-engine'
import { toolRegistry } from '../lib/tools'

export function meta() {
	return [
		{ title: 'Chat - React Router App' },
		{
			name: 'description',
			content: 'Chat with our AI assistant powered by WebLLM',
		},
	]
}

type Message = {
	id: string
	text: string
	sender: 'user' | 'assistant' | 'tool' | 'system'
	timestamp: Date
}

type ModelInfo = {
	id: string
	name: string
	description: string
	category: string
	vramRequired: number
	lowResource: boolean
}

// Tool calling types
type ToolCall = {
	id: string
	name: string
	arguments: Record<string, unknown>
}

type ToolResult = {
	id: string
	result?: string
	error?: string
}

// Pending tool call for approval
type PendingToolCall = {
	id: string
	toolCall: ToolCall
	messageId: string
	conversationId: string
	approvalMessageId: string
}

// Approval settings
type ApprovalSettings = {
	conversationApprovals: Set<string> // Set of tool names approved for this conversation
	globalApprovals: Set<string> // Set of tool names approved globally
}

// Model mapping configuration
const MODEL_MAPPINGS = {
	categories: {
		'Llama-3.1': 'Llama 3.x',
		'Llama-3.2': 'Llama 3.x',
		'Llama-3': 'Llama 3',
		'Llama-2': 'Llama 2',
		Qwen: 'Qwen',
		Phi: 'Phi',
		Gemma: 'Gemma',
		Mistral: 'Mistral',
		Hermes: 'Hermes',
		DeepSeek: 'DeepSeek',
		SmolLM: 'SmolLM',
		TinyLlama: 'TinyLlama',
		StableLM: 'StableLM',
		RedPajama: 'RedPajama',
		WizardMath: 'WizardMath',
		OpenHermes: 'Hermes Variants',
		NeuralHermes: 'Hermes Variants',
	},
	names: {
		'Llama-3.1-8B': 'Llama 3.1 8B',
		'Llama-3.1-70B': 'Llama 3.1 70B',
		'Llama-3.2-1B': 'Llama 3.2 1B',
		'Llama-3.2-3B': 'Llama 3.2 3B',
		'Llama-3-8B': 'Llama 3 8B',
		'Llama-3-70B': 'Llama 3 70B',
		'Llama-2-7b': 'Llama 2 7B',
		'Llama-2-13b': 'Llama 2 13B',
		'Qwen3-0.6B': 'Qwen 3 0.6B',
		'Qwen3-1.7B': 'Qwen 3 1.7B',
		'Qwen3-4B': 'Qwen 3 4B',
		'Qwen3-8B': 'Qwen 3 8B',
		'Qwen2.5-0.5B': 'Qwen 2.5 0.5B',
		'Qwen2.5-1.5B': 'Qwen 2.5 1.5B',
		'Qwen2.5-3B': 'Qwen 2.5 3B',
		'Qwen2.5-7B': 'Qwen 2.5 7B',
		'Qwen2-0.5B': 'Qwen 2 0.5B',
		'Qwen2-1.5B': 'Qwen 2 1.5B',
		'Qwen2-7B': 'Qwen 2 7B',
		'Phi-3.5-mini': 'Phi 3.5 Mini',
		'Phi-3.5-vision': 'Phi 3.5 Vision',
		'Phi-3-mini': 'Phi 3 Mini',
		'Phi-2': 'Phi 2',
		'Phi-1_5': 'Phi 1.5',
		'gemma-2-2b': 'Gemma 2 2B',
		'gemma-2-9b': 'Gemma 2 9B',
		'Mistral-7B': 'Mistral 7B',
		'Hermes-2-Theta': 'Hermes 2 Theta',
		'Hermes-2-Pro': 'Hermes 2 Pro',
		'Hermes-3': 'Hermes 3',
		'DeepSeek-R1': 'DeepSeek R1',
		'SmolLM2-1.7B': 'SmolLM2 1.7B',
		'SmolLM2-360M': 'SmolLM2 360M',
		'SmolLM2-135M': 'SmolLM2 135M',
		'TinyLlama-1.1B': 'TinyLlama 1.1B',
		'stablelm-2-zephyr': 'StableLM 2 Zephyr',
		'RedPajama-INCITE': 'RedPajama INCITE',
		'WizardMath-7B': 'WizardMath 7B',
		'OpenHermes-2.5': 'OpenHermes 2.5',
		'NeuralHermes-2.5': 'NeuralHermes 2.5',
	},
	descriptions: {
		vision: 'vision model',
		Math: 'math-focused model',
		Coder: 'code-focused model',
		Instruct: 'instruction-tuned model',
		Chat: 'chat model',
	},
} as const

// Tool execution function
async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
	try {
		if (!toolRegistry.has(toolCall.name)) {
			return {
				id: toolCall.id,
				error: `Unknown tool: ${toolCall.name}`,
			}
		}

		const result = await toolRegistry.execute(toolCall.name, toolCall.arguments)
		return {
			id: toolCall.id,
			result,
		}
	} catch (error) {
		return {
			id: toolCall.id,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
	}
}

// Parse tool calls from response text
function parseToolCalls(text: string, expectedId: string) {
	const toolCallRegex = new RegExp(
		`\\[TOOL_CALL:${expectedId}\\](.*?)\\[\\/TOOL_CALL:${expectedId}\\]`,
		'gs',
	)
	const toolCalls: ToolCall[] = []
	let cleanText = text

	// Find all tool calls
	const matches: Array<{ match: RegExpExecArray; index: number }> = []
	let match
	while ((match = toolCallRegex.exec(text)) !== null) {
		matches.push({ match, index: match.index })
	}

	// Only process the first tool call (if any)
	if (matches.length > 0) {
		const firstMatch = matches[0]
		const payload = firstMatch.match[1]
		try {
			const parsedPayload = JSON.parse(payload)
			toolCalls.push({
				id: expectedId,
				name: parsedPayload.name,
				arguments: parsedPayload.arguments || {},
			})
		} catch (error) {
			console.error('Failed to parse tool call payload:', error)
		}

		// Remove only the first tool call from the text
		const beforeToolCall = text.substring(0, firstMatch.index)
		const afterToolCall = text.substring(
			firstMatch.index + firstMatch.match[0].length,
		)
		cleanText = (beforeToolCall + afterToolCall).trim()
	}

	return { toolCalls, cleanText }
}

// Create system prompt
function createSystemPrompt(
	toolDescriptions: string,
	id: string,
	options?: {
		toolCallCount?: number
		maxToolCalls?: number
		toolResult?: string
	},
): string {
	// If no tools are available, return a simple prompt without tool calling
	if (!toolDescriptions.trim()) {
		return `You are a helpful AI assistant. Be concise and friendly in your responses.`
	}

	const basePrompt = `You are a helpful AI assistant. Be concise and friendly in your responses.

You have access to the following tools:
${toolDescriptions}

To use a tool, you must provide a name and arguments in a JSON object wrapped in [TOOL_CALL:${id}] and [/TOOL_CALL:${id}]

For example:
[TOOL_CALL:${id}]{ "name": "send_message", "arguments": { "message": "Hello World" } }[/TOOL_CALL:${id}]

If no arguments are needed, arguments can be omitted:
[TOOL_CALL:${id}]{ "name": "get_current_time" }[/TOOL_CALL:${id}]

IMPORTANT: If you need to use a tool, you can only make ONE tool call per response. The tool call must be the LAST thing in your response. Any explanatory text should come BEFORE the tool call.

If no provided tools are applicable, do not bother using them.

Only use tools when explicitly requested or when it would be helpful for the user.`

	if (
		options?.toolCallCount !== undefined &&
		options?.maxToolCalls !== undefined
	) {
		return `${basePrompt}

Tool call count: ${options.toolCallCount}/${options.maxToolCalls}

The last tool call returned: ${options.toolResult || 'No result'}

Continue the conversation based on this result. If you need to make another tool call, do so (remember: only ONE tool call per response, and it must be the LAST thing in your response). If the task is complete, provide a final response without using any tools.`
	}

	return basePrompt
}

// Create LLM messages
function createLlmMessages(
	systemPrompt: string,
	messages: Message[],
	userMessage?: string,
): ChatCompletionMessageParam[] {
	const llmMessages: ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemPrompt },
		...messages
			.filter((msg) => msg.sender !== 'system')
			.map((msg) => {
				if (msg.sender === 'tool') {
					return {
						role: 'tool' as const,
						content: msg.text,
						tool_call_id: msg.id,
					}
				}
				return {
					role: (msg.sender === 'user' ? 'user' : 'assistant') as
						| 'user'
						| 'assistant',
					content: msg.text,
				}
			}),
	]

	if (userMessage) {
		llmMessages.push({ role: 'user', content: userMessage })
	}

	return llmMessages
}

// Stream LLM response
async function streamLlmResponse(
	engine: MLCEngine,
	messages: ChatCompletionMessageParam[],
	messageId: string,
	updateMessage: (text: string) => void,
): Promise<string> {
	console.log('[Chat]: creating completion', messages)
	const chunks = await engine.chat.completions.create({
		messages,
		temperature: 0.7,
		stream: true,
		stream_options: { include_usage: true },
	})

	let fullResponse = ''
	for await (const chunk of chunks) {
		const content = chunk.choices[0]?.delta.content
		if (content) {
			fullResponse += content
			updateMessage(fullResponse)
		}
	}

	return fullResponse
}

// Update message text
function updateMessageText(
	messages: Message[],
	messageId: string,
	newText: string,
): Message[] {
	return messages.map((msg) =>
		msg.id === messageId ? { ...msg, text: newText } : msg,
	)
}

// Create pending tool call
function createPendingToolCall(
	toolCall: ToolCall,
	messageId: string,
	conversationId: string,
	approvalMessageId: string,
): PendingToolCall {
	return {
		id: toolCall.id,
		toolCall,
		messageId,
		conversationId,
		approvalMessageId,
	}
}

// Categorize model
function categorizeModel(modelId: string): string {
	for (const [pattern, category] of Object.entries(MODEL_MAPPINGS.categories)) {
		if (modelId.includes(pattern)) return category
	}
	return 'Other'
}

// Generate model name
function generateModelName(modelId: string): string {
	let name = modelId.replace('-MLC', '').replace('-MLC-1k', '')

	for (const [pattern, displayName] of Object.entries(MODEL_MAPPINGS.names)) {
		if (name.includes(pattern)) return displayName
	}

	return name
}

// Generate model description
function generateModelDescription(
	modelId: string,
	vramRequired: number,
	lowResource: boolean,
): string {
	const size =
		vramRequired < 1000
			? `${Math.round(vramRequired)}MB`
			: `${(vramRequired / 1000).toFixed(1)}GB`
	const resource = lowResource ? 'Low-resource' : 'Standard'

	for (const [pattern, description] of Object.entries(
		MODEL_MAPPINGS.descriptions,
	)) {
		if (modelId.includes(pattern)) {
			return `${resource} ${description} (${size} VRAM)`
		}
	}

	return `${resource} model (${size} VRAM)`
}

// Get error message
function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown error'
}

// Client-side only timestamp component
function Timestamp({ timestamp }: { timestamp: Date }) {
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		setMounted(true)
	}, [])

	if (!mounted) {
		return <span className="invisible">--:--</span>
	}

	return (
		<span>
			{timestamp.toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true,
			})}
		</span>
	)
}

export default function Chat() {
	const [messages, setMessages] = useState<Message[]>([])
	const [inputValue, setInputValue] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [isInitializing, setIsInitializing] = useState(true)
	const [initializationProgress, setInitializationProgress] = useState('')
	const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
	const [selectedModel, setSelectedModel] = useState<string>('')
	const [error, setError] = useState<string | null>(null)
	const [engine, setEngine] = useState<MLCEngine | null>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)

	// Queue for messages sent while model is loading
	const [pendingMessages, setPendingMessages] = useState<Message[]>([])

	// Tool approval state
	const [pendingToolCall, setPendingToolCall] =
		useState<PendingToolCall | null>(null)
	const [approvalSettings, setApprovalSettings] = useState<ApprovalSettings>({
		conversationApprovals: new Set(),
		globalApprovals: new Set(),
	})
	const [conversationId] = useState(() => crypto.randomUUID())

	// Agentic loop state
	const [toolCallCount, setToolCallCount] = useState(0)
	const [maxToolCalls] = useState(25)
	const [isInAgenticLoop, setIsInAgenticLoop] = useState(false)

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages])

	// Helper function to check if a tool is approved
	function isToolApproved(toolName: string): boolean {
		return (
			approvalSettings.globalApprovals.has(toolName) ||
			approvalSettings.conversationApprovals.has(toolName)
		)
	}

	// Helper function to process pending messages
	async function processPendingMessages(engine: MLCEngine) {
		if (pendingMessages.length === 0) return

		setIsLoading(true)
		setError(null)

		try {
			for (const pendingMessage of pendingMessages) {
				// Process the message (it's already in the messages array)
				await processMessage(pendingMessage, engine)
			}
		} catch (err) {
			console.error('Failed to process pending messages:', err)
			setError(`Failed to process pending messages: ${getErrorMessage(err)}`)
		} finally {
			setIsLoading(false)
			setPendingMessages([]) // Clear the pending messages
		}
	}

	// Helper function to process a single message
	async function processMessage(message: Message, engine: MLCEngine) {
		setToolCallCount(0)
		setIsInAgenticLoop(true)

		try {
			const relevantTools = await getRelevantTools(message.text)
			const toolDescriptions = generateToolDescriptions(relevantTools)

			console.log(
				`Search engine filtered tools: ${Object.keys(relevantTools).length} tools`,
				relevantTools,
			)

			const id = crypto.randomUUID()
			const systemPrompt = createSystemPrompt(toolDescriptions, id)
			const llmMessages = createLlmMessages(
				systemPrompt,
				messages,
				message.text,
			)

			const assistantMessageId = (Date.now() + 1).toString()
			const assistantMessage: Message = {
				id: assistantMessageId,
				text: '',
				sender: 'assistant',
				timestamp: new Date(),
			}

			setMessages((prev) => [...prev, assistantMessage])

			const updateMessage = (fullResponse: string) => {
				setMessages((prev) =>
					updateMessageText(prev, assistantMessageId, fullResponse),
				)
			}

			const fullResponse = await streamLlmResponse(
				engine,
				llmMessages,
				assistantMessageId,
				updateMessage,
			)

			const { toolCalls, cleanText } = parseToolCalls(fullResponse, id)

			if (toolCalls.length > 0) {
				await processToolCalls(toolCalls, assistantMessageId, cleanText, id)
			} else {
				setMessages((prev) =>
					updateMessageText(prev, assistantMessageId, cleanText),
				)
			}
		} catch (err) {
			console.error('Failed to get response:', err)
			setError(`Failed to get response: ${getErrorMessage(err)}`)
			setMessages((prev) => prev.filter((msg) => msg.text !== ''))
		} finally {
			setIsInAgenticLoop(false)
		}
	}

	// Helper function to handle tool call approval
	async function handleToolCallApproval(
		approvalType: 'instance' | 'conversation' | 'global' | 'reject',
	) {
		if (!pendingToolCall) return

		const { toolCall, messageId } = pendingToolCall

		// Always clear the pending tool call first to dismiss the dialog
		setPendingToolCall(null)

		if (approvalType === 'reject') {
			// Remove the approval message and add a rejection message as a tool message
			setMessages((prev) => {
				const filteredMessages = prev.filter(
					(msg) => msg.id !== pendingToolCall.approvalMessageId,
				)
				const rejectionMessage: Message = {
					id: toolCall.id,
					text: '❌ Tool call rejected by user.',
					sender: 'tool',
					timestamp: new Date(),
				}
				const newMessages = [...filteredMessages, rejectionMessage]

				// Continue the agentic loop after the rejection message is added
				setTimeout(
					() =>
						continueAgenticLoop(toolCall.id, '❌ Tool call rejected by user.'),
					0,
				)

				return newMessages
			})
			return
		}

		// Update approval settings based on approval type
		setApprovalSettings((prev) => {
			const newSettings = { ...prev }
			if (approvalType === 'conversation') {
				newSettings.conversationApprovals = new Set([
					...prev.conversationApprovals,
					toolCall.name,
				])
			} else if (approvalType === 'global') {
				newSettings.globalApprovals = new Set([
					...prev.globalApprovals,
					toolCall.name,
				])
			}
			return newSettings
		})

		// Execute the tool call
		try {
			const result = await executeTool(toolCall)
			const resultText = result.error
				? `Error: ${result.error}`
				: result.result || 'No result'

			// Remove the approval message and add tool result as a separate message
			setMessages((prev) => {
				const filteredMessages = prev.filter(
					(msg) => msg.id !== pendingToolCall.approvalMessageId,
				)
				const toolMessage: Message = {
					id: toolCall.id,
					text: resultText,
					sender: 'tool',
					timestamp: new Date(),
				}
				const newMessages = [...filteredMessages, toolMessage]

				// Continue the agentic loop after the messages are updated
				setTimeout(() => continueAgenticLoop(toolCall.id, resultText), 0)

				return newMessages
			})
		} catch (error) {
			const errorText = `Tool execution failed: ${getErrorMessage(error)}`

			// Remove the approval message and add tool error as a separate message
			setMessages((prev) => {
				const filteredMessages = prev.filter(
					(msg) => msg.id !== pendingToolCall.approvalMessageId,
				)
				const toolMessage: Message = {
					id: toolCall.id,
					text: errorText,
					sender: 'tool',
					timestamp: new Date(),
				}
				return [...filteredMessages, toolMessage]
			})

			setIsInAgenticLoop(false)
		}
	}

	// Helper function to get relevant tools
	async function getRelevantTools(
		userMessage?: string,
	): Promise<Record<string, ToolDefinition>> {
		let relevantTools: Record<string, ToolDefinition> = {}
		try {
			const conversationContext = SearchEngine.buildConversationContext(
				messages,
				userMessage || '',
			)

			const searchResults = await searchEngine.search(conversationContext)
			if (searchResults.length > 0) {
				const filteredTools: Record<string, any> = {}
				searchResults.forEach((result) => {
					filteredTools[result.tool.name] = {
						name: result.tool.name,
						description: result.tool.description,
						parameters: result.tool.parameters,
					}
				})
				relevantTools = filteredTools
			}
		} catch (searchError) {
			console.error('Search failed, using all tools:', searchError)
			const allTools = searchEngine.getAllTools()
			allTools.forEach((tool) => {
				relevantTools[tool.name] = tool
			})
		}
		return relevantTools
	}

	// Helper function to generate tool descriptions
	function generateToolDescriptions(
		tools: Record<string, ToolDefinition>,
	): string {
		return Object.values(tools)
			.map((tool) => `- ${tool.name}: ${tool.description}`)
			.join('\n')
	}

	// Helper function to process tool calls
	async function processToolCalls(
		toolCalls: ToolCall[],
		messageId: string,
		cleanText: string,
		id: string,
	): Promise<void> {
		const unapprovedToolCalls = toolCalls.filter(
			(toolCall) => !isToolApproved(toolCall.name),
		)

		if (unapprovedToolCalls.length > 0) {
			// Add a separate assistant message for the approval request
			const approvalMessageId = (Date.now() + 1).toString()
			const approvalMessage: Message = {
				id: approvalMessageId,
				text: `⏳ **Tool call requires approval:** ${unapprovedToolCalls[0].name}`,
				sender: 'system',
				timestamp: new Date(),
			}
			setMessages((prev) => [...prev, approvalMessage])

			setPendingToolCall(
				createPendingToolCall(
					unapprovedToolCalls[0],
					messageId,
					conversationId,
					approvalMessageId,
				),
			)

			// Update the assistant message with just the clean text
			setMessages((prev) => updateMessageText(prev, messageId, cleanText))
		} else {
			const toolResults = await Promise.all(
				toolCalls.map((toolCall) => executeTool(toolCall)),
			)

			// Update the assistant message with just the clean text
			setMessages((prev) => updateMessageText(prev, messageId, cleanText))

			// Add tool results as separate messages
			const toolMessages: Message[] = toolResults.map((result) => ({
				id: result.id,
				text: result.error
					? `Error: ${result.error}`
					: result.result || 'No result',
				sender: 'tool',
				timestamp: new Date(),
			}))

			setMessages((prev) => {
				const newMessages = [...prev, ...toolMessages]

				// Continue the agentic loop after the tool messages are added
				if (toolResults.length > 0) {
					const firstResult = toolResults[0]
					const resultText = firstResult.error
						? `Error: ${firstResult.error}`
						: firstResult.result || 'No result'
					setTimeout(() => continueAgenticLoop(firstResult.id, resultText), 0)
				}

				return newMessages
			})
		}
	}

	// Continue the agentic loop with tool results
	async function continueAgenticLoop(messageId: string, toolResult: string) {
		if (!engine || toolCallCount >= maxToolCalls) {
			setIsInAgenticLoop(false)
			return
		}

		setToolCallCount((prev) => prev + 1)

		try {
			const id = crypto.randomUUID()
			const relevantTools = await getRelevantTools()
			const toolDescriptions = generateToolDescriptions(relevantTools)

			const systemPrompt = createSystemPrompt(toolDescriptions, id, {
				toolCallCount: toolCallCount + 1,
				maxToolCalls,
				toolResult,
			})

			const llmMessages = createLlmMessages(systemPrompt, messages)

			// Create a new assistant message for the continuation
			const assistantMessageId = (Date.now() + 1).toString()
			const assistantMessage: Message = {
				id: assistantMessageId,
				text: '',
				sender: 'assistant',
				timestamp: new Date(),
			}

			setMessages((prev) => [...prev, assistantMessage])

			const updateMessage = (fullResponse: string) => {
				setMessages((prev) =>
					updateMessageText(prev, assistantMessageId, fullResponse),
				)
			}

			const fullResponse = await streamLlmResponse(
				engine,
				llmMessages,
				assistantMessageId,
				updateMessage,
			)

			const { toolCalls, cleanText } = parseToolCalls(fullResponse, id)

			if (toolCalls.length > 0 && toolCallCount < maxToolCalls) {
				await processToolCalls(toolCalls, assistantMessageId, cleanText, id)
			} else {
				setIsInAgenticLoop(false)
				if (toolCallCount >= maxToolCalls) {
					// Update the assistant message with the maximum tool calls warning
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? {
										...msg,
										text:
											msg.text +
											'\n\n⚠️ Maximum tool calls reached (25). Stopping agentic loop.',
									}
								: msg,
						),
					)
				}
			}
		} catch (error) {
			console.error('Failed to continue agentic loop:', error)
			setIsInAgenticLoop(false)
			// Create a new assistant message for the error
			const errorMessageId = (Date.now() + 1).toString()
			const errorMessage: Message = {
				id: errorMessageId,
				text: `❌ Agentic loop failed: ${getErrorMessage(error)}`,
				sender: 'assistant',
				timestamp: new Date(),
			}
			setMessages((prev) => [...prev, errorMessage])
		}
	}

	// Initialize available models from WebLLM and search engine
	useEffect(() => {
		async function initializeModels() {
			try {
				await searchEngine.initialize('Llama-3.1-8B-Instruct-q4f32_1-MLC')
			} catch (error) {
				console.error('Failed to initialize search engine:', error)
			}

			const models: ModelInfo[] = prebuiltAppConfig.model_list
				.filter((model) => !model.model_id.includes('embed'))
				.map((model) => ({
					id: model.model_id,
					name: generateModelName(model.model_id),
					description: generateModelDescription(
						model.model_id,
						model.vram_required_MB || 0,
						model.low_resource_required || false,
					),
					category: categorizeModel(model.model_id),
					vramRequired: model.vram_required_MB || 0,
					lowResource: model.low_resource_required || false,
				}))
				.sort((a, b) => {
					if (a.category !== b.category) {
						return a.category.localeCompare(b.category)
					}
					return a.vramRequired - b.vramRequired
				})

			setAvailableModels(models)

			const defaultModel =
				models.find((m) =>
					m.id.includes('Llama-3.1-8B-Instruct-q4f32_1-MLC'),
				) || models[0]
			setSelectedModel(defaultModel?.id || '')
		}

		initializeModels()
	}, [])

	// Initialize the LLM engine
	useEffect(() => {
		if (!selectedModel) return

		async function initializeEngine() {
			try {
				setIsInitializing(true)
				setError(null)

				const initProgressCallback: InitProgressCallback = (progress) => {
					const progressPercent = Math.round((progress.progress || 0) * 100)
					setInitializationProgress(`Initializing model... ${progressPercent}%`)
				}

				const newEngine = await CreateMLCEngine(selectedModel, {
					initProgressCallback,
				})

				setEngine(newEngine)
				setIsInitializing(false)
				setInitializationProgress('')

				const selectedModelInfo = availableModels.find(
					(m) => m.id === selectedModel,
				)
				setMessages((prev) => [
					...prev,
					{
						id: Date.now().toString(),
						text: `Model "${selectedModelInfo?.name}" loaded successfully! Ready to chat.`,
						sender: 'system',
						timestamp: new Date(),
					},
				])

				// Process any pending messages that were sent while the model was loading
				if (pendingMessages.length > 0) {
					processPendingMessages(newEngine)
				}
			} catch (err) {
				console.error('Failed to initialize engine:', err)
				setError(`Failed to initialize model: ${getErrorMessage(err)}`)
				setIsInitializing(false)
			}
		}

		// Cancel any existing initialization by setting engine to null first
		setEngine(null)
		initializeEngine()
	}, [selectedModel, availableModels])

	async function handleSendMessage() {
		if (!inputValue.trim() || isLoading) return

		const userMessage: Message = {
			id: Date.now().toString(),
			text: inputValue.trim(),
			sender: 'user',
			timestamp: new Date(),
		}

		setInputValue('')
		setError(null)

		// If model is still loading, add message to pending queue
		if (!engine || isInitializing) {
			setPendingMessages((prev) => [...prev, userMessage])
			setMessages((prev) => [...prev, userMessage])
			return
		}

		// Model is ready, process the message immediately
		setMessages((prev) => [...prev, userMessage])
		setIsLoading(true)
		setToolCallCount(0)
		setIsInAgenticLoop(true)

		try {
			await processMessage(userMessage, engine)
		} catch (err) {
			console.error('Failed to get response:', err)
			setError(`Failed to get response: ${getErrorMessage(err)}`)
			setMessages((prev) => prev.filter((msg) => msg.text !== ''))
		} finally {
			setIsLoading(false)
		}
	}

	function handleKeyPress(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSendMessage()
		}
	}

	function handleModelChange(modelId: string) {
		setSelectedModel(modelId)
		setError(null) // Clear any previous errors when changing models
		setEngine(null) // Clear the current engine to trigger re-initialization
	}

	// Group models by category
	const groupedModels = availableModels.reduce(
		function (acc, model) {
			if (!acc[model.category]) {
				acc[model.category] = []
			}
			acc[model.category].push(model)
			return acc
		},
		{} as Record<string, ModelInfo[]>,
	)

	// Remove the full-screen loading state since users can now change models during initialization

	return (
		<div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
			{/* Header */}
			<header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
				<div className="flex items-start justify-between">
					<div>
						<h1 className="text-xl font-semibold text-gray-900 dark:text-white">
							Chat Assistant
						</h1>
						<p className="text-sm text-gray-600 dark:text-gray-400">
							Powered by WebLLM
						</p>
					</div>

					{/* Model Selector */}
					<div className="flex flex-col items-end space-y-2">
						<label className="text-sm font-medium text-gray-700 dark:text-gray-300">
							Model:
						</label>
						<select
							value={selectedModel}
							onChange={(e) => handleModelChange(e.target.value)}
							className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
						>
							{Object.entries(groupedModels).map(([category, models]) => (
								<optgroup key={category} label={category}>
									{models.map((model) => (
										<option key={model.id} value={model.id}>
											{model.name} - {model.description}
										</option>
									))}
								</optgroup>
							))}
						</select>
						{isInitializing && (
							<div className="text-xs text-amber-600 dark:text-amber-400">
								<p>⏳ Initializing model...</p>
								{initializationProgress && (
									<p className="text-xs text-gray-500 dark:text-gray-400">
										{initializationProgress}
									</p>
								)}
								{pendingMessages.length > 0 && (
									<p className="text-xs text-blue-600 dark:text-blue-400">
										📝 {pendingMessages.length} message
										{pendingMessages.length > 1 ? 's' : ''} queued
									</p>
								)}
							</div>
						)}
					</div>
				</div>
			</header>

			{/* Error Display */}
			{error && (
				<div className="border border-red-200 bg-red-50 px-6 py-3 dark:border-red-800 dark:bg-red-900/20">
					<p className="text-sm text-red-800 dark:text-red-200">{error}</p>
				</div>
			)}

			{/* Messages */}
			<div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
				{!engine && !isInitializing && (
					<div className="flex justify-start">
						<div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
							<p className="text-sm text-gray-600 dark:text-gray-400">
								Please select a model to start chatting.
							</p>
						</div>
					</div>
				)}
				{isInitializing && pendingMessages.length > 0 && (
					<div className="flex justify-start">
						<div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 dark:border-blue-700 dark:bg-blue-900/20">
							<p className="text-sm text-blue-800 dark:text-blue-200">
								📝 {pendingMessages.length} message
								{pendingMessages.length > 1 ? 's' : ''} queued - will be
								processed when model finishes loading
							</p>
						</div>
					</div>
				)}
				{messages.map((message) => (
					<div
						key={message.id}
						className={`flex ${
							message.sender === 'user' ? 'justify-end' : 'justify-start'
						}`}
					>
						<div
							className={`max-w-xs rounded-lg px-4 py-2 lg:max-w-md ${
								message.sender === 'user'
									? 'bg-blue-600 text-white'
									: message.sender === 'tool'
										? 'border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200'
										: 'border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
							}`}
						>
							{message.sender === 'tool' && (
								<p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
									🔧 Tool Result
								</p>
							)}
							<p className="text-sm whitespace-pre-wrap">{message.text}</p>

							{/* Inline tool approval UI */}
							{pendingToolCall &&
								pendingToolCall.approvalMessageId === message.id && (
									<div className="mt-3 space-y-2">
										<details className="rounded border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700">
											<summary className="cursor-pointer p-2 text-sm font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-600">
												🔧 View Tool Details
											</summary>
											<div className="border-t border-gray-200 p-3 dark:border-gray-600">
												<div className="space-y-2">
													<div>
														<span className="font-semibold text-gray-700 dark:text-gray-300">
															Tool:
														</span>
														<span className="ml-2 font-mono text-sm text-gray-600 dark:text-gray-400">
															{pendingToolCall.toolCall.name}
														</span>
													</div>
													<div>
														<span className="font-semibold text-gray-700 dark:text-gray-300">
															Arguments:
														</span>
														<pre className="mt-1 max-h-32 overflow-auto rounded bg-white p-2 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">
															{JSON.stringify(
																pendingToolCall.toolCall.arguments,
																null,
																2,
															)}
														</pre>
													</div>
												</div>
											</div>
										</details>

										<div className="flex flex-wrap gap-1">
											<button
												onClick={() => handleToolCallApproval('instance')}
												className="rounded bg-blue-600 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-700 focus:ring-1 focus:ring-blue-500"
											>
												✅ Once
											</button>
											<button
												onClick={() => handleToolCallApproval('conversation')}
												className="rounded bg-green-600 px-2 py-1 text-xs text-white transition-colors hover:bg-green-700 focus:ring-1 focus:ring-green-500"
											>
												✅ Conversation
											</button>
											<button
												onClick={() => handleToolCallApproval('global')}
												className="rounded bg-purple-600 px-2 py-1 text-xs text-white transition-colors hover:bg-purple-700 focus:ring-1 focus:ring-purple-500"
											>
												✅ Global
											</button>
											<button
												onClick={() => handleToolCallApproval('reject')}
												className="rounded bg-red-600 px-2 py-1 text-xs text-white transition-colors hover:bg-red-700 focus:ring-1 focus:ring-red-500"
											>
												❌ Reject
											</button>
										</div>
									</div>
								)}

							<p
								className={`mt-1 text-xs ${
									message.sender === 'user'
										? 'text-blue-200'
										: message.sender === 'tool'
											? 'text-amber-600 dark:text-amber-400'
											: 'text-gray-500 dark:text-gray-400'
								}`}
							>
								<Timestamp timestamp={message.timestamp} />
							</p>
						</div>
					</div>
				))}

				{isLoading && (
					<div className="flex justify-start">
						<div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
							<div className="flex items-center space-x-2">
								<div className="flex space-x-1">
									<div className="h-2 w-2 animate-bounce rounded-full bg-gray-400"></div>
									<div
										className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
										style={{ animationDelay: '0.1s' }}
									></div>
									<div
										className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
										style={{ animationDelay: '0.2s' }}
									></div>
								</div>
								{isInAgenticLoop && (
									<span className="text-xs text-gray-500 dark:text-gray-400">
										🤖 Agentic loop ({toolCallCount}/{maxToolCalls})
									</span>
								)}
							</div>
						</div>
					</div>
				)}
				<div ref={messagesEndRef} />
			</div>

			{/* Input */}
			<div className="border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
				<div className="flex space-x-4">
					<div className="flex-1">
						<textarea
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyPress={handleKeyPress}
							placeholder={
								!engine
									? isInitializing
										? 'Type your message (will be processed when model loads)...'
										: 'Select a model to start chatting'
									: 'Type your message...'
							}
							className="w-full resize-none rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
							rows={1}
							disabled={isLoading}
						/>
					</div>
					<button
						onClick={handleSendMessage}
						disabled={!inputValue.trim() || isLoading}
						className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{!engine
							? isInitializing
								? 'Queue Message'
								: 'Select Model'
							: 'Send'}
					</button>
				</div>
			</div>
		</div>
	)
}
