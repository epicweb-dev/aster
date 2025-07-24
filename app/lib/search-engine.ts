import {
	type ChatCompletionMessageParam,
	type ChatCompletionTool,
} from '@mlc-ai/web-llm'

// Lazy initialization for search worker
let searchWorker: Worker | null = null
let isInitializing = false

export async function getSearchWorker() {
	if (searchWorker || isInitializing) return searchWorker

	isInitializing = true

	try {
		// Create Web Worker for search functionality
		searchWorker = new Worker(new URL('./search-worker.ts', import.meta.url), {
			type: 'module',
		})

		return searchWorker
	} catch (error) {
		console.error('Failed to create search worker:', error)
		throw error
	} finally {
		isInitializing = false
	}
}

export async function search(messages: Array<ChatCompletionMessageParam>) {
	try {
		const worker = await getSearchWorker()
		if (!worker) {
			console.warn('Search worker not available, returning no tools')
			return []
		}

		return new Promise<
			Array<
				ChatCompletionTool & {
					id: string
					relevanceScore: number
					llmDescription: string
				}
			>
		>((resolve, reject) => {
			const searchId = crypto.randomUUID()

			const handleMessage = (event: MessageEvent) => {
				if (event.data.id !== searchId) return

				if (event.data.type === 'search-result') {
					worker.removeEventListener('message', handleMessage)
					resolve(event.data.results)
				} else if (event.data.type === 'search-error') {
					worker.removeEventListener('message', handleMessage)
					reject(new Error(event.data.error))
				}
			}

			worker.addEventListener('message', handleMessage)

			// Send search request to worker
			worker.postMessage({
				type: 'search',
				id: searchId,
				messages,
			})

			// Set a timeout to prevent hanging
			setTimeout(() => {
				worker.removeEventListener('message', handleMessage)
				reject(new Error('Search timeout'))
			}, 30000)
		})
	} catch (error) {
		console.error('Search failed:', error)
		return []
	}
}
