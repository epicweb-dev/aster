import {
	CreateMLCEngine,
	type MLCEngine,
	type InitProgressCallback,
} from '@mlc-ai/web-llm'
import { toolRegistry } from './tools'

// Tool definition type
export type ToolDefinition = {
	name: string
	description: string
	parameters: {
		type: string
		properties: Record<string, any>
		required: string[]
	}
}

// Search result type
export type SearchResult = {
	tool: ToolDefinition
	relevanceScore: number
	reasoning: string
}

// Search engine configuration
export type SearchEngineConfig = {
	modelId: string
	temperature: number
	maxResults: number
	relevanceThreshold: number
	maxQueryLength: number
}

export class SearchEngine {
	#engine: MLCEngine | null = null
	#config: SearchEngineConfig
	#isInitializing = false

	constructor(config: Partial<SearchEngineConfig> = {}) {
		this.#config = {
			modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
			temperature: 0.1,
			maxResults: 5,
			relevanceThreshold: 0.7,
			maxQueryLength: 2000,
			...config,
		}
	}

	// Initialize the search engine with a specific model
	async initialize(
		modelId?: string,
		progressCallback?: InitProgressCallback,
	): Promise<void> {
		if (this.#isInitializing) return

		this.#isInitializing = true

		try {
			const modelToUse = modelId || this.#config.modelId

			this.#engine = await CreateMLCEngine(modelToUse, {
				initProgressCallback: progressCallback,
			})
		} catch (error) {
			console.error('Failed to initialize search engine:', error)
			throw error
		} finally {
			this.#isInitializing = false
		}
	}

	// Get tools from the tool registry
	getTools(): ToolDefinition[] {
		return toolRegistry.getAllDefinitions()
	}

	// Search for relevant tools based on user query or conversation context
	// The query can be a simple search term or a full conversation history
	async search(query: string): Promise<SearchResult[]> {
		// Wait for the search engine to be ready
		await this.#waitForReady()

		const tools = this.getTools()
		if (tools.length === 0) {
			return []
		}

		// Create a prompt for the LLM to evaluate tool relevance
		const toolsDescription = tools
			.map((tool, index) => `${index + 1}. ${tool.name}: ${tool.description}`)
			.join('\n')

		// Truncate very long queries to avoid token limits
		const truncatedQuery =
			query.length > this.#config.maxQueryLength
				? query.substring(0, this.#config.maxQueryLength) + '...'
				: query

		const searchPrompt = `You are a tool search engine. Given a conversation context, evaluate which tools are most relevant for the current user request.

Available tools:
${toolsDescription}

Conversation context:
${truncatedQuery}

For each relevant tool, provide:
1. Tool name
2. Relevance score (0.0 to 1.0)
3. Brief reasoning for why this tool is relevant

Format your response as a JSON array of objects with these fields:
- tool_name: string
- relevance_score: number (0.0 to 1.0)
- reasoning: string

Only include tools with relevance scores >= ${this.#config.relevanceThreshold}.
Return at most ${this.#config.maxResults} tools, sorted by relevance score (highest first).

Here is an example of a response:
[{"tool_name":"alert","relevance_score":1.0,"reasoning":"The user is asking to display an alert message."}]

If no tools are relevant, return an empty array:
[]

Do not include any other text in your response.

Response:`

		try {
			console.log('[SearchEngine]: creating completion', searchPrompt)
			const response = await this.#engine!.chat.completions.create({
				messages: [{ role: 'user', content: searchPrompt }],
				temperature: this.#config.temperature,
				max_tokens: 1000,
			})

			const content = response.choices[0]?.message?.content
			if (!content) {
				return []
			}

			// Parse the JSON response
			try {
				const results = JSON.parse(content) as Array<{
					tool_name: string
					relevance_score: number
					reasoning: string
				}>

				// Convert to SearchResult format
				return results
					.filter((result) => {
						const tool = tools.find((t) => t.name === result.tool_name)
						return (
							tool && result.relevance_score >= this.#config.relevanceThreshold
						)
					})
					.map((result) => {
						const tool = tools.find((t) => t.name === result.tool_name)!
						return {
							tool,
							relevanceScore: result.relevance_score,
							reasoning: result.reasoning,
						}
					})
					.sort((a, b) => b.relevanceScore - a.relevanceScore)
					.slice(0, this.#config.maxResults)
			} catch (parseError) {
				console.error('Failed to parse search results:', parseError, content)
				return []
			}
		} catch (error) {
			console.error('Search failed:', error)
			return []
		}
	}

	// Wait for the search engine to be ready
	async #waitForReady(): Promise<void> {
		while (!this.#engine || this.#isInitializing) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	// Get all available tools
	getAllTools(): ToolDefinition[] {
		return this.getTools()
	}

	// Update configuration
	updateConfig(newConfig: Partial<SearchEngineConfig>): void {
		this.#config = { ...this.#config, ...newConfig }
	}

	// Get current configuration
	getConfig(): SearchEngineConfig {
		return { ...this.#config }
	}

	// Check if the search engine is ready
	isReady(): boolean {
		return this.#engine !== null && !this.#isInitializing
	}

	// Get initialization status
	getInitializationStatus(): { isInitializing: boolean; isReady: boolean } {
		return {
			isInitializing: this.#isInitializing,
			isReady: this.isReady(),
		}
	}

	// Build conversation context from messages
	static buildConversationContext(
		messages: Array<{ sender: string; text: string }>,
		currentQuery: string,
	): string {
		const conversationHistory = messages
			.map((msg) => `${msg.sender}: ${msg.text}`)
			.join('\n')
		return `${conversationHistory}\n\nCurrent query: ${currentQuery}`
	}
}

// Create a singleton instance
export const searchEngine = new SearchEngine()

// Legacy functions for backward compatibility
export function createToolDefinition(
	name: string,
	description: string,
	parameters: Record<string, any>,
): ToolDefinition {
	return {
		name,
		description,
		parameters: {
			type: 'object',
			properties: parameters,
			required: Object.keys(parameters).filter(
				(key) => parameters[key].required !== false,
			),
		},
	}
}

export function registerDefaultTools(searchEngineInstance: SearchEngine): void {
	// Tools are now registered in the tool registry, so this function is a no-op
	// It's kept for backward compatibility
	console.log('Tools are now managed by the tool registry')
}
