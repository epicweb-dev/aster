import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'
import { getAvailableTools, getTool } from './tools.js'

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

async function performSearch(messages: Array<any>) {
	try {
		// Initialize the engine if needed
		const llmEngine = await initializeEngine()
		if (!llmEngine) {
			console.warn('Web-LLM engine not available, returning no tools')
			return []
		}

		// Get all available tool definitions from the registry
		const allToolDefinitions = await getAvailableTools()

		// Build conversation context from messages
		const conversationContext = messages
			.map((msg) => `${msg.role}: ${msg.content}`)
			.join('\n')

		// Create tools description for the prompt
		const toolsDescription = allToolDefinitions
			.map(
				(tool, index) =>
					`${index + 1}. ${tool.function.name}: ${tool.function.description}`,
			)
			.join('\n')

		// Create the search prompt
		const searchPrompt = `You are a tool recommendation engine. Given a conversation context, evaluate which tools are most relevant for the current user request.

<available_tools>
${toolsDescription}
</available_tools>

<conversation_context>
${conversationContext}
</conversation_context>

For each relevant tool, provide:
1. Tool name
2. Relevance score (0.0 to 1.0)
3. Brief reasoning for why this tool is relevant

Format your response as a JSON array of objects with these fields:
- tool_id: string
- relevance_score: number (0.0 to 1.0)
- reasoning: string

Only include tools with relevance scores >= 0.7.
Return at most 5 tools, sorted by relevance score (highest first).

Here is an example of a response:
[{"tool_id":"alert","relevance_score":1.0,"reasoning":"The user is asking to display an alert message."}]

If no tools are relevant, return an empty array:
[]

Do not include any other text in your response.`

		console.log('performing search with the following prompt: \n', {
			searchPrompt,
		})
		// Send the search prompt to the LLM
		const response = await llmEngine.chat.completions.create({
			messages: [{ role: 'user', content: searchPrompt }],
			temperature: 0.1, // Low temperature for more consistent results
			max_tokens: 1000,
			stream: false,
		})
		console.log('search performed, got the following response: \n', response)

		const responseContent = response.choices[0]?.message?.content
		if (!responseContent) {
			console.warn('No response content from LLM. Returning no tools.')
			return []
		}

		// Parse the JSON response
		try {
			const results = JSON.parse(responseContent) as Array<{
				tool_id: string
				relevance_score: number
				reasoning: string
			}>

			// Filter and sort results
			const relevantTools = results
				.filter((result) => result.relevance_score >= 0.7)
				.sort((a, b) => b.relevance_score - a.relevance_score)
				.slice(0, 5)

			// Convert tool names to ChatCompletionTool objects
			const recommendedTools: Array<any> = []

			for (const result of relevantTools) {
				// First try to find in the new tool registry
				const registryTool = await getTool(result.tool_id)
				if (registryTool) {
					recommendedTools.push({
						id: result.tool_id,
						type: 'function',
						relevanceScore: result.relevance_score,
						llmDescription: `<tool><id>${result.tool_id}</id><relevance_score>${result.relevance_score}</relevance_score><name>${registryTool.function.name}</name><description>${registryTool.function.description}</description><parameters>${JSON.stringify(registryTool.function.parameters)}</parameters></tool>`,
						function: registryTool.function,
					})
				}
			}

			return recommendedTools
		} catch (parseError) {
			console.error(
				'Failed to parse search results:',
				parseError,
				responseContent,
			)
			return []
		}
	} catch (error) {
		console.error('Search failed:', error)
		return []
	}
}

self.onmessage = async (msg: MessageEvent) => {
	// Handle MLCEngine messages
	if (msg.data.type === 'mlc-engine') {
		handler.onmessage(msg)
		return
	}

	// Handle search messages
	if (msg.data.type === 'search') {
		try {
			const results = await performSearch(msg.data.messages)
			self.postMessage({
				type: 'search-result',
				id: msg.data.id,
				results,
			})
		} catch (error) {
			self.postMessage({
				type: 'search-error',
				id: msg.data.id,
				error: error instanceof Error ? error.message : String(error),
			})
		}
		return
	}
}
