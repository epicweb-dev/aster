import { useState, useEffect, useRef } from 'react'
import type { Route } from './+types/search'
import {
	searchEngine,
	registerDefaultTools,
	type SearchResult,
} from '../lib/search-engine'

export function meta() {
	return [
		{ title: 'Tool Search - React Router App' },
		{
			name: 'description',
			content: 'Search for relevant tools using AI-powered search engine',
		},
	]
}

export default function Search() {
	const [query, setQuery] = useState('')
	const [searchResults, setSearchResults] = useState<SearchResult[]>([])
	const [isSearching, setIsSearching] = useState(false)
	const [isInitializing, setIsInitializing] = useState(true)
	const [initializationProgress, setInitializationProgress] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [allTools, setAllTools] = useState<SearchResult[]>([])

	// Initialize search engine
	useEffect(() => {
		async function initializeSearchEngine() {
			try {
				setIsInitializing(true)
				setError(null)

				// Register default tools
				registerDefaultTools(searchEngine)

				// Initialize the search engine
				await searchEngine.initialize(
					'Llama-3.1-8B-Instruct-q4f32_1-MLC',
					(progress) => {
						const progressPercent = Math.round((progress.progress || 0) * 100)
						setInitializationProgress(
							`Initializing search engine... ${progressPercent}%`,
						)
					},
				)

				// Get all available tools for display
				const tools = searchEngine.getAllTools()
				setAllTools(
					tools.map((tool) => ({
						tool,
						relevanceScore: 1.0,
						reasoning: 'Available tool',
					})),
				)

				setIsInitializing(false)
				setInitializationProgress('')
			} catch (err) {
				console.error('Failed to initialize search engine:', err)
				setError(
					`Failed to initialize search engine: ${
						err instanceof Error ? err.message : 'Unknown error'
					}`,
				)
				setIsInitializing(false)
			}
		}

		initializeSearchEngine()
	}, [])

	// Perform search
	async function performSearch() {
		if (!query.trim()) return

		setIsSearching(true)
		setError(null)

		try {
			const results = await searchEngine.search(query.trim())
			setSearchResults(results)
		} catch (err) {
			console.error('Search failed:', err)
			setError(
				`Search failed: ${
					err instanceof Error ? err.message : 'Unknown error'
				}`,
			)
		} finally {
			setIsSearching(false)
		}
	}

	function handleKeyPress(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			performSearch()
		}
	}

	if (isInitializing) {
		return (
			<div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
				<header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
					<h1 className="text-xl font-semibold text-gray-900 dark:text-white">
						Tool Search Engine
					</h1>
					<p className="text-sm text-gray-600 dark:text-gray-400">
						Initializing AI-powered search...
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
				<h1 className="text-xl font-semibold text-gray-900 dark:text-white">
					Tool Search Engine
				</h1>
				<p className="text-sm text-gray-600 dark:text-gray-400">
					AI-powered tool search using WebLLM
				</p>
			</header>

			{/* Error Display */}
			{error && (
				<div className="border border-red-200 bg-red-50 px-6 py-3 dark:border-red-800 dark:bg-red-900/20">
					<p className="text-sm text-red-800 dark:text-red-200">{error}</p>
				</div>
			)}

			{/* Search Input */}
			<div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
				<div className="flex space-x-4">
					<div className="flex-1">
						<input
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyPress={handleKeyPress}
							placeholder="Search for tools (e.g., 'find files', 'read code', 'edit files')..."
							className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
							disabled={isSearching}
						/>
						<p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
							💡 Tip: You can also paste conversation context to see which tools
							would be relevant for that conversation.
						</p>
					</div>
					<button
						onClick={performSearch}
						disabled={!query.trim() || isSearching}
						className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isSearching ? 'Searching...' : 'Search'}
					</button>
				</div>
			</div>

			{/* Results */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				{searchResults.length > 0 ? (
					<div className="space-y-4">
						<h2 className="text-lg font-semibold text-gray-900 dark:text-white">
							Search Results ({searchResults.length})
						</h2>
						{searchResults.map((result, index) => (
							<div
								key={index}
								className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
							>
								<div className="flex items-start justify-between">
									<div className="flex-1">
										<h3 className="text-lg font-medium text-gray-900 dark:text-white">
											{result.tool.name}
										</h3>
										<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
											{result.tool.description}
										</p>
										<div className="mt-2">
											<span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
												Relevance: {(result.relevanceScore * 100).toFixed(0)}%
											</span>
										</div>
										<p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
											<strong>Reasoning:</strong> {result.reasoning}
										</p>
									</div>
								</div>
							</div>
						))}
					</div>
				) : query && !isSearching ? (
					<div className="py-8 text-center">
						<p className="text-gray-500 dark:text-gray-400">
							No relevant tools found for "{query}"
						</p>
					</div>
				) : null}

				{/* All Available Tools */}
				{!query && (
					<div className="space-y-4">
						<h2 className="text-lg font-semibold text-gray-900 dark:text-white">
							All Available Tools ({allTools.length})
						</h2>
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							{allTools.map((result, index) => (
								<div
									key={index}
									className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
								>
									<h3 className="text-lg font-medium text-gray-900 dark:text-white">
										{result.tool.name}
									</h3>
									<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
										{result.tool.description}
									</p>
									{result.tool.parameters.required.length > 0 && (
										<div className="mt-2">
											<p className="text-xs text-gray-500 dark:text-gray-400">
												<strong>Required:</strong>{' '}
												{result.tool.parameters.required.join(', ')}
											</p>
										</div>
									)}
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
