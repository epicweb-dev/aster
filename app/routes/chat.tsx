import { useState, useEffect, useRef } from 'react'
import type { Route } from './+types/chat'
import { CreateMLCEngine, prebuiltAppConfig, type MLCEngine, type InitProgressCallback, type ChatCompletionMessageParam } from '@mlc-ai/web-llm'

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
	sender: 'user' | 'assistant'
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

// Available tools
const availableTools = {
	alert: {
		name: 'alert',
		description: 'Display an alert message to the user',
		parameters: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					description: 'The message to display in the alert'
				}
			},
			required: ['message']
		}
	}
}

// Tool execution function
async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
	try {
		// Check if the tool exists
		const tool = availableTools[toolCall.name as keyof typeof availableTools]
		if (!tool) {
			return {
				id: toolCall.id,
				error: `Unknown tool: ${toolCall.name}`
			}
		}

		// Validate required parameters
		const requiredParams = tool.parameters.required || []
		for (const param of requiredParams) {
			if (!(param in toolCall.arguments)) {
				return {
					id: toolCall.id,
					error: `Missing required parameter: ${param}`
				}
			}
		}

		// Execute the tool
		switch (toolCall.name) {
			case 'alert':
				alert(toolCall.arguments.message)
				return {
					id: toolCall.id,
					result: `Alert: ${toolCall.arguments.message}`
				}
			default:
				return {
					id: toolCall.id,
					error: `Tool execution not implemented: ${toolCall.name}`
				}
		}
	} catch (error) {
		return {
			id: toolCall.id,
			error: error instanceof Error ? error.message : 'Unknown error'
		}
	}
}

// Parse tool calls from response text
function parseToolCalls(text: string, expectedId: string) {
	const toolCallRegex = new RegExp(`\\[TOOL_CALL:${expectedId}\\](.*?)\\[\\/TOOL_CALL:${expectedId}\\]`, 'gs')
	const toolCalls: ToolCall[] = []
	let cleanText = text

	let match
	while ((match = toolCallRegex.exec(text)) !== null) {
		const payload = match[1]
		try {
			const parsedPayload = JSON.parse(payload)
			toolCalls.push({
				id: expectedId,
				name: parsedPayload.name,
				arguments: parsedPayload.arguments || {}
			})
		} catch (error) {
			console.error('Failed to parse tool call payload:', error)
		}
	}

	// Remove tool call markers from the text
	cleanText = text.replace(toolCallRegex, '').trim()

	return { toolCalls, cleanText }
}

// Helper function to categorize models
function categorizeModel(modelId: string) {
	if (modelId.includes('Llama-3.1') || modelId.includes('Llama-3.2')) return 'Llama 3.x'
	if (modelId.includes('Llama-3')) return 'Llama 3'
	if (modelId.includes('Llama-2')) return 'Llama 2'
	if (modelId.includes('Qwen')) return 'Qwen'
	if (modelId.includes('Phi')) return 'Phi'
	if (modelId.includes('Gemma')) return 'Gemma'
	if (modelId.includes('Mistral')) return 'Mistral'
	if (modelId.includes('Hermes')) return 'Hermes'
	if (modelId.includes('DeepSeek')) return 'DeepSeek'
	if (modelId.includes('SmolLM')) return 'SmolLM'
	if (modelId.includes('TinyLlama')) return 'TinyLlama'
	if (modelId.includes('StableLM')) return 'StableLM'
	if (modelId.includes('RedPajama')) return 'RedPajama'
	if (modelId.includes('WizardMath')) return 'WizardMath'
	if (modelId.includes('OpenHermes') || modelId.includes('NeuralHermes')) return 'Hermes Variants'
	return 'Other'
}

// Helper function to generate model name
function generateModelName(modelId: string) {
	// Remove MLC suffix and quantization info for display
	let name = modelId.replace('-MLC', '').replace('-MLC-1k', '')
	
	// Extract model family and size
	if (name.includes('Llama-3.1-8B')) return 'Llama 3.1 8B'
	if (name.includes('Llama-3.1-70B')) return 'Llama 3.1 70B'
	if (name.includes('Llama-3.2-1B')) return 'Llama 3.2 1B'
	if (name.includes('Llama-3.2-3B')) return 'Llama 3.2 3B'
	if (name.includes('Llama-3-8B')) return 'Llama 3 8B'
	if (name.includes('Llama-3-70B')) return 'Llama 3 70B'
	if (name.includes('Llama-2-7b')) return 'Llama 2 7B'
	if (name.includes('Llama-2-13b')) return 'Llama 2 13B'
	if (name.includes('Qwen3-0.6B')) return 'Qwen 3 0.6B'
	if (name.includes('Qwen3-1.7B')) return 'Qwen 3 1.7B'
	if (name.includes('Qwen3-4B')) return 'Qwen 3 4B'
	if (name.includes('Qwen3-8B')) return 'Qwen 3 8B'
	if (name.includes('Qwen2.5-0.5B')) return 'Qwen 2.5 0.5B'
	if (name.includes('Qwen2.5-1.5B')) return 'Qwen 2.5 1.5B'
	if (name.includes('Qwen2.5-3B')) return 'Qwen 2.5 3B'
	if (name.includes('Qwen2.5-7B')) return 'Qwen 2.5 7B'
	if (name.includes('Qwen2-0.5B')) return 'Qwen 2 0.5B'
	if (name.includes('Qwen2-1.5B')) return 'Qwen 2 1.5B'
	if (name.includes('Qwen2-7B')) return 'Qwen 2 7B'
	if (name.includes('Phi-3.5-mini')) return 'Phi 3.5 Mini'
	if (name.includes('Phi-3.5-vision')) return 'Phi 3.5 Vision'
	if (name.includes('Phi-3-mini')) return 'Phi 3 Mini'
	if (name.includes('Phi-2')) return 'Phi 2'
	if (name.includes('Phi-1_5')) return 'Phi 1.5'
	if (name.includes('gemma-2-2b')) return 'Gemma 2 2B'
	if (name.includes('gemma-2-9b')) return 'Gemma 2 9B'
	if (name.includes('Mistral-7B')) return 'Mistral 7B'
	if (name.includes('Hermes-2-Theta')) return 'Hermes 2 Theta'
	if (name.includes('Hermes-2-Pro')) return 'Hermes 2 Pro'
	if (name.includes('Hermes-3')) return 'Hermes 3'
	if (name.includes('DeepSeek-R1')) return 'DeepSeek R1'
	if (name.includes('SmolLM2-1.7B')) return 'SmolLM2 1.7B'
	if (name.includes('SmolLM2-360M')) return 'SmolLM2 360M'
	if (name.includes('SmolLM2-135M')) return 'SmolLM2 135M'
	if (name.includes('TinyLlama-1.1B')) return 'TinyLlama 1.1B'
	if (name.includes('stablelm-2-zephyr')) return 'StableLM 2 Zephyr'
	if (name.includes('RedPajama-INCITE')) return 'RedPajama INCITE'
	if (name.includes('WizardMath-7B')) return 'WizardMath 7B'
	if (name.includes('OpenHermes-2.5')) return 'OpenHermes 2.5'
	if (name.includes('NeuralHermes-2.5')) return 'NeuralHermes 2.5'
	
	return name
}

// Helper function to generate model description
function generateModelDescription(modelId: string, vramRequired: number, lowResource: boolean) {
	const size = vramRequired < 1000 ? `${Math.round(vramRequired)}MB` : `${(vramRequired / 1000).toFixed(1)}GB`
	const resource = lowResource ? 'Low-resource' : 'Standard'
	
	if (modelId.includes('vision')) return `${resource} vision model (${size} VRAM)`
	if (modelId.includes('Math')) return `${resource} math-focused model (${size} VRAM)`
	if (modelId.includes('Coder')) return `${resource} code-focused model (${size} VRAM)`
	if (modelId.includes('Instruct')) return `${resource} instruction-tuned model (${size} VRAM)`
	if (modelId.includes('Chat')) return `${resource} chat model (${size} VRAM)`
	
	return `${resource} model (${size} VRAM)`
}

export default function Chat() {
	const [messages, setMessages] = useState<Message[]>([
		{
			id: '1',
			text: "Hello! I'm an AI assistant powered by WebLLM. How can I help you today?",
			sender: 'assistant',
			timestamp: new Date(),
		},
	])
	const [inputValue, setInputValue] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [isInitializing, setIsInitializing] = useState(true)
	const [initializationProgress, setInitializationProgress] = useState('')
	const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
	const [selectedModel, setSelectedModel] = useState<string>('')
	const [error, setError] = useState<string | null>(null)
	const [engine, setEngine] = useState<MLCEngine | null>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages])

	// Initialize available models from WebLLM
	useEffect(() => {
		function initializeModels() {
			const models: ModelInfo[] = prebuiltAppConfig.model_list
				.filter(model => !model.model_id.includes('embed')) // Filter out embedding models
				.map(model => ({
					id: model.model_id,
					name: generateModelName(model.model_id),
					description: generateModelDescription(
						model.model_id,
						model.vram_required_MB || 0,
						model.low_resource_required || false
					),
					category: categorizeModel(
						model.model_id
					),
					vramRequired: model.vram_required_MB || 0,
					lowResource: model.low_resource_required || false,
				}))
				.sort((a, b) => {
					// Sort by category first, then by VRAM requirement
					if (a.category !== b.category) {
						return a.category.localeCompare(b.category)
					}
					return a.vramRequired - b.vramRequired
				})

			setAvailableModels(models)
			
			// Set default model to a reasonable choice (Llama 3.1 8B if available, otherwise first model)
			const defaultModel = models.find(m => m.id.includes('Llama-3.1-8B-Instruct-q4f32_1-MLC')) || models[0]
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
					setInitializationProgress(
						`Initializing model... ${progressPercent}%`,
					)
				}

				const newEngine = await CreateMLCEngine(selectedModel, {
					initProgressCallback,
				})

				setEngine(newEngine)
				setIsInitializing(false)
				setInitializationProgress('')

				// Add a welcome message after initialization
				const selectedModelInfo = availableModels.find(m => m.id === selectedModel)
				setMessages((prev) => [
					...prev,
					{
						id: Date.now().toString(),
						text: `Model "${selectedModelInfo?.name}" loaded successfully! Ready to chat.`,
						sender: 'assistant',
						timestamp: new Date(),
					},
				])
			} catch (err) {
				console.error('Failed to initialize engine:', err)
				setError(
					`Failed to initialize model: ${
						err instanceof Error ? err.message : 'Unknown error'
					}`,
				)
				setIsInitializing(false)
			}
		}

		initializeEngine()
	}, [selectedModel, availableModels])

	async function handleSendMessage() {
		if (!inputValue.trim() || isLoading || !engine) return

		const userMessage: Message = {
			id: Date.now().toString(),
			text: inputValue.trim(),
			sender: 'user',
			timestamp: new Date(),
		}

		setMessages((prev) => [...prev, userMessage])
		setInputValue('')
		setIsLoading(true)
		setError(null)

		try {
			// Prepare messages for the LLM
			const id = crypto.randomUUID()
			// Generate tool descriptions from availableTools
			const toolDescriptions = Object.values(availableTools)
				.map((tool) => `- ${tool.name}: ${tool.description}`)
				.join('\n')

			const llmMessages: ChatCompletionMessageParam[] = [
				{
					role: 'system',
					content: `You are a helpful AI assistant. Be concise and friendly in your responses.

You have access to the following tools:
${toolDescriptions}

To use a tool, format your response like this:
[TOOL_CALL:${id}]{ "name": "alert", "arguments": { "message": "Hello World" } }[/TOOL_CALL:${id}]

Only use tools when explicitly requested or when it would be helpful for the user.`,
				},
				...messages.map((msg) => ({
					role: (msg.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
					content: msg.text,
				})),
				{ role: 'user', content: userMessage.text },
			]

			// Create a placeholder message for streaming
			const assistantMessageId = (Date.now() + 1).toString()
			const assistantMessage: Message = {
				id: assistantMessageId,
				text: '',
				sender: 'assistant',
				timestamp: new Date(),
			}

			setMessages((prev) => [...prev, assistantMessage])

			// Get streaming response
			const chunks = await engine.chat.completions.create({
				messages: llmMessages,
				temperature: 0.7,
				stream: true,
				stream_options: { include_usage: true },
			})

			let fullResponse = ''
			for await (const chunk of chunks) {
				const content = chunk.choices[0]?.delta.content || ''
				fullResponse += content

				// Update the message with the accumulated response
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === assistantMessageId
							? { ...msg, text: fullResponse }
							: msg,
					),
				)
			}

			// Process tool calls after the full response is received
			const { toolCalls, cleanText } = parseToolCalls(fullResponse, id)
			
			if (toolCalls.length > 0) {
				// Execute all tool calls
				const toolResults = await Promise.all(
					toolCalls.map(toolCall => executeTool(toolCall))
				)

				// Update the message with clean text and tool results
				const toolResultsText = toolResults
					.map(result => result.error ? `Error: ${result.error}` : result.result)
					.join('\n')

				const finalText = cleanText + (toolResultsText ? `\n\nTool Results:\n${toolResultsText}` : '')
				
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === assistantMessageId
							? { ...msg, text: finalText }
							: msg,
					),
				)
			}
		} catch (err) {
			console.error('Failed to get response:', err)
			setError(
				`Failed to get response: ${
					err instanceof Error ? err.message : 'Unknown error'
				}`,
			)

			// Remove the empty assistant message if there was an error
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
		if (isLoading) return // Prevent changing model while loading
		setSelectedModel(modelId)
		setMessages([
			{
				id: '1',
				text: "Hello! I'm an AI assistant powered by WebLLM. How can I help you today?",
				sender: 'assistant',
				timestamp: new Date(),
			},
		])
	}

	// Group models by category
	const groupedModels = availableModels.reduce(function(acc, model) {
		if (!acc[model.category]) {
			acc[model.category] = []
		}
		acc[model.category].push(model)
		return acc
	}, {} as Record<string, ModelInfo[]>)

	if (isInitializing) {
		return (
			<div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
				<header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
					<h1 className="text-xl font-semibold text-gray-900 dark:text-white">
						Chat Assistant
					</h1>
					<p className="text-sm text-gray-600 dark:text-gray-400">
						Initializing AI model...
					</p>
				</header>

				<div className="flex flex-1 items-center justify-center">
					<div className="text-center">
						<div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
						<p className="text-gray-600 dark:text-gray-400">
							{initializationProgress}
						</p>
						<p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
							This may take a few minutes on first load...
						</p>
					</div>
				</div>
			</div>
		)
	}

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
							disabled={isLoading}
							className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
									: 'border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
							}`}
						>
							<p className="text-sm whitespace-pre-wrap">{message.text}</p>
							<p
								className={`mt-1 text-xs ${
									message.sender === 'user'
										? 'text-blue-200'
										: 'text-gray-500 dark:text-gray-400'
								}`}
							>
								{message.timestamp.toLocaleTimeString()}
							</p>
						</div>
					</div>
				))}

				{isLoading && (
					<div className="flex justify-start">
						<div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
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
							placeholder="Type your message..."
							className="w-full resize-none rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
							rows={1}
							disabled={isLoading || !engine}
						/>
					</div>
					<button
						onClick={handleSendMessage}
						disabled={!inputValue.trim() || isLoading || !engine}
						className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Send
					</button>
				</div>
			</div>
		</div>
	)
}
