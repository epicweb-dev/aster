import { getSearchWorker, search } from '../lib/search-engine'
import { getChatWorker, chatStream } from '../lib/chat-engine'
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm'

export function clientLoader() {
	// preload workers
	void getSearchWorker()
	void getChatWorker()
}

export default function Playground() {
	async function generateResponse() {
		console.log('generating response. Starting with search')
		const messages = [
			{
				role: 'user',
				content:
					'What is the weather in Highland, Utah in Fahrenheit right now?',
			},
		] as Array<ChatCompletionMessageParam>
		const searchResults = await search(messages)
		console.log(searchResults)

		let response = ''

		try {
			const stream = chatStream(
				messages,
				searchResults.map((tool) => ({
					type: 'function',
					function: tool.function,
				})),
			)

			for await (const chunk of stream) {
				response += chunk.content
				console.log('Streaming chunk:', chunk.content)
				console.log('Full response so far:', response)
			}

			console.log('Final response:', response)
		} catch (error) {
			console.error('Chat error:', error)
		}
	}
	return (
		<div>
			<h1 className="text-2xl font-bold">Playground</h1>
			<button
				className="rounded-md bg-blue-500 p-2 text-white"
				onClick={generateResponse}
			>
				Search
			</button>
		</div>
	)
}
