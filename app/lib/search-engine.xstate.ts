import { setup, assign, createActor, fromPromise } from 'xstate'
import {
	CreateMLCEngine,
	type MLCEngine,
	type InitProgressCallback,
} from '@mlc-ai/web-llm'
import { toolRegistry } from './tools'
import type {
	ToolDefinition,
	SearchResult,
	SearchEngineConfig,
} from './search-engine'

export interface SearchEngineMachineContext {
	engine: MLCEngine | null
	config: SearchEngineConfig
	isInitializing: boolean
	tools: ToolDefinition[]
	searchResults: SearchResult[]
	error: unknown | null
	previousState?: string
}

export type SearchEngineMachineEvent =
	| {
			type: 'INITIALIZE'
			modelId?: string
			progressCallback?: InitProgressCallback
	  }
	| { type: 'INITIALIZED'; engine: MLCEngine }
	| { type: 'INITIALIZE_FAILED'; error: unknown }
	| { type: 'SEARCH'; query: string }
	| { type: 'SEARCH_SUCCESS'; results: SearchResult[] }
	| { type: 'SEARCH_FAILED'; error: unknown }
	| { type: 'UPDATE_CONFIG'; newConfig: Partial<SearchEngineConfig> }
	| { type: 'CONFIG_UPDATED' }
	| { type: 'GET_TOOLS' }
	| { type: 'RESET_ERROR' }

const defaultConfig: SearchEngineConfig = {
	modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
	temperature: 0.1,
	maxResults: 5,
	relevanceThreshold: 0.7,
	maxQueryLength: 2000,
}

const initializeEngine = fromPromise(
	async ({
		input,
	}: {
		input: {
			modelId?: string
			progressCallback?: InitProgressCallback
			context: SearchEngineMachineContext
		}
	}) => {
		const modelToUse = input.modelId || input.context.config.modelId
		return await CreateMLCEngine(modelToUse, {
			initProgressCallback: input.progressCallback,
		})
	},
)

const performSearch = fromPromise(
	async ({
		input,
	}: {
		input: { query: string; context: SearchEngineMachineContext }
	}) => {
		const { engine, config } = input.context
		if (!engine) throw new Error('Engine not initialized')
		const tools = toolRegistry.getAllDefinitions()
		if (tools.length === 0) return []
		const toolsDescription = tools
			.map((tool, index) => `${index + 1}. ${tool.name}: ${tool.description}`)
			.join('\n')
		const query = input.query
		const truncatedQuery =
			query.length > config.maxQueryLength
				? query.substring(0, config.maxQueryLength) + '...'
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

Only include tools with relevance scores >= ${config.relevanceThreshold}.
Return at most ${config.maxResults} tools, sorted by relevance score (highest first).

Here is an example of a response:
[{"tool_name":"alert","relevance_score":1.0,"reasoning":"The user is asking to display an alert message."}]

If no tools are relevant, return an empty array:
[]

Do not include any other text in your response.

Response:`
		const response = await engine.chat.completions.create({
			messages: [{ role: 'user', content: searchPrompt }],
			temperature: config.temperature,
			max_tokens: 1000,
		})
		const content = response.choices[0]?.message?.content
		if (!content) return []
		try {
			const results = JSON.parse(content) as Array<{
				tool_name: string
				relevance_score: number
				reasoning: string
			}>
			return results
				.filter((result) => {
					const tool = tools.find((t) => t.name === result.tool_name)
					return tool && result.relevance_score >= config.relevanceThreshold
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
				.slice(0, config.maxResults)
		} catch (e) {
			throw new Error('Failed to parse search results: ' + (e as Error).message)
		}
	},
)

const updateConfig = fromPromise(
	async ({
		input,
	}: {
		input: {
			newConfig: Partial<SearchEngineConfig>
			context: SearchEngineMachineContext
		}
	}) => {
		return { ...input.context.config, ...input.newConfig }
	},
)

function engineReady({ context }: { context: SearchEngineMachineContext }) {
	return !!context.engine && !context.isInitializing
}
function notInitializing({ context }: { context: SearchEngineMachineContext }) {
	return !context.isInitializing
}
function hasEngine({ context }: { context: SearchEngineMachineContext }) {
	return !!context.engine
}

export const searchEngineMachine = setup({
	types: {
		context: {} as SearchEngineMachineContext,
		events: {} as SearchEngineMachineEvent,
	},
	actors: {
		initializeEngine,
		performSearch,
		updateConfig,
	},
	guards: {
		engineReady,
		notInitializing,
		hasEngine,
	},
	actions: {},
}).createMachine({
	id: 'searchEngine',
	initial: 'idle',
	context: {
		engine: null,
		config: defaultConfig,
		isInitializing: false,
		tools: toolRegistry.getAllDefinitions(),
		searchResults: [],
		error: null,
		previousState: undefined,
	},
	states: {
		idle: {
			on: {
				INITIALIZE: {
					target: 'initializing',
					guard: notInitializing,
					actions: assign({ isInitializing: true, error: null }),
				},
				UPDATE_CONFIG: {
					target: 'updatingConfig',
				},
			},
		},
		initializing: {
			invoke: {
				src: initializeEngine,
				input: ({ event, context }) => ({
					modelId: event.type === 'INITIALIZE' ? event.modelId : undefined,
					progressCallback:
						event.type === 'INITIALIZE' ? event.progressCallback : undefined,
					context,
				}),
				onDone: {
					target: 'ready',
					actions: assign({
						engine: ({ event }) => event.output as MLCEngine,
						isInitializing: false,
						error: null,
					}),
				},
				onError: {
					target: 'error',
					actions: assign({
						error: ({ event }) => event.error,
						isInitializing: false,
						previousState: 'idle',
					}),
				},
			},
		},
		ready: {
			on: {
				SEARCH: {
					target: 'searching',
					guard: engineReady,
				},
				UPDATE_CONFIG: {
					target: 'updatingConfig',
				},
			},
		},
		searching: {
			invoke: {
				src: performSearch,
				input: ({ event, context }) => ({
					query: event.type === 'SEARCH' ? event.query : '',
					context,
				}),
				onDone: {
					target: 'ready',
					actions: assign({
						searchResults: ({ event }) => event.output as SearchResult[],
						error: null,
					}),
				},
				onError: {
					target: 'error',
					actions: assign({
						error: ({ event }) => event.error,
						previousState: 'ready',
					}),
				},
			},
		},
		updatingConfig: {
			entry: assign({ error: null }),
			invoke: {
				src: updateConfig,
				input: ({ event, context }) => ({
					newConfig: event.type === 'UPDATE_CONFIG' ? event.newConfig : {},
					context,
				}),
				onDone: [
					{
						target: 'ready',
						guard: hasEngine,
						actions: assign({
							config: ({ event }) => event.output as SearchEngineConfig,
						}),
					},
					{
						target: 'idle',
						actions: assign({
							config: ({ event }) => event.output as SearchEngineConfig,
						}),
					},
				],
				onError: {
					target: 'error',
					actions: assign({ error: ({ event }) => event.error }),
				},
			},
			on: {
				CONFIG_UPDATED: [
					{
						target: 'ready',
						guard: hasEngine,
						actions: assign({ error: null }),
					},
					{
						target: 'idle',
						actions: assign({ error: null }),
					},
				],
			},
		},
		error: {
			on: {
				RESET_ERROR: [
					{
						target: 'ready',
						guard: hasEngine,
						actions: assign({ error: null }),
					},
					{
						target: 'idle',
						actions: assign({ error: null }),
					},
				],
			},
		},
	},
})

export const searchEngineService = createActor(searchEngineMachine)

export const selectors = {
	isReady: (state: ReturnType<typeof searchEngineService.getSnapshot>) =>
		state.matches('ready'),
	isInitializing: (state: ReturnType<typeof searchEngineService.getSnapshot>) =>
		state.matches('initializing'),
	getConfig: (state: ReturnType<typeof searchEngineService.getSnapshot>) =>
		state.context.config,
	getTools: (state: ReturnType<typeof searchEngineService.getSnapshot>) =>
		state.context.tools,
	getSearchResults: (
		state: ReturnType<typeof searchEngineService.getSnapshot>,
	) => state.context.searchResults,
	getError: (state: ReturnType<typeof searchEngineService.getSnapshot>) =>
		state.context.error,
}
