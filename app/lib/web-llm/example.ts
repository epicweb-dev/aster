import { createActor } from 'xstate'
import { webLLMMachine, type ChatCompletionOptions } from './machine'
import type { ChatCompletionMessage } from '@mlc-ai/web-llm'

// Example usage of the WebLLM state machine
export class WebLLMClient {
	private actor: ReturnType<typeof createActor<typeof webLLMMachine>>
	private subscribers: Set<(state: any) => void> = new Set()

	constructor(modelId?: string) {
		this.actor = createActor(webLLMMachine, {
			input: { modelId },
		})

		// Subscribe to state changes
		this.actor.subscribe((state) => {
			this.subscribers.forEach((callback) => callback(state))
		})

		// Start the actor
		this.actor.start()
	}

	// Load a model
	async loadModel(modelId: string, engineConfig?: any, chatOpts?: any) {
		this.actor.send({
			type: 'LOAD_MODEL',
			modelId,
			engineConfig,
			chatOpts,
		})

		// Wait for the model to be loaded
		return new Promise<void>((resolve, reject) => {
			const subscription = this.actor.subscribe((state) => {
				if (state.matches('ready')) {
					subscription.unsubscribe()
					resolve()
				} else if (state.matches('error')) {
					subscription.unsubscribe()
					reject(new Error(state.context.error || 'Failed to load model'))
				}
			})
		})
	}

	// Start a chat completion with streaming
	async startChat(
		messages: ChatCompletionMessage[],
		options?: ChatCompletionOptions,
	) {
		if (!this.actor.getSnapshot().context.isModelLoaded) {
			throw new Error('Model not loaded. Call loadModel() first.')
		}

		this.actor.send({
			type: 'START_CHAT',
			messages,
			options: {
				stream: true,
				temperature: 0.7,
				maxTokens: 1000,
				...options,
			},
		})

		// Return a promise that resolves when the chat is complete
		return new Promise<{ content: string; usage: any }>((resolve, reject) => {
			const subscription = this.actor.subscribe((state) => {
				if (state.matches('ready') && !state.context.isStreaming) {
					subscription.unsubscribe()
					resolve({
						content: state.context.streamedContent,
						usage: state.context.usage,
					})
				} else if (state.matches('error')) {
					subscription.unsubscribe()
					reject(new Error(state.context.error || 'Chat failed'))
				}
			})
		})
	}

	// Get the current state
	getState() {
		return this.actor.getSnapshot()
	}

	// Subscribe to state changes
	subscribe(callback: (state: any) => void) {
		this.subscribers.add(callback)
		return () => {
			this.subscribers.delete(callback)
		}
	}

	// Clear chat history
	clearChat() {
		this.actor.send({ type: 'CLEAR_CHAT' })
	}

	// Teardown and cleanup
	teardown() {
		this.actor.send({ type: 'TEARDOWN' })
		this.actor.stop()
	}

	// Reset the machine
	reset() {
		this.actor.send({ type: 'RESET' })
	}
}

// Example usage
export async function exampleUsage() {
	const client = new WebLLMClient()

	try {
		// Load a model
		console.log('Loading model...')
		await client.loadModel('Llama-3.1-8B-Instruct-q4f32_1-MLC', {
			initProgressCallback: (progress: any) => {
				console.log('Loading progress:', progress)
			},
		})
		console.log('Model loaded successfully!')

		// Subscribe to state changes for real-time updates
		const unsubscribe = client.subscribe((state) => {
			if (state.context.isStreaming) {
				console.log('Streaming content:', state.context.streamedContent)
			}
		})

		// Start a chat
		const messages: ChatCompletionMessage[] = [
			{ role: 'assistant', content: 'You are a helpful AI assistant.' },
			{ role: 'assistant', content: 'Hello! How are you today?' },
		]

		console.log('Starting chat...')
		const result = await client.startChat(messages, {
			temperature: 0.8,
			maxTokens: 500,
		})

		console.log('Chat completed!')
		console.log('Final content:', result.content)
		console.log('Usage:', result.usage)

		// Cleanup
		unsubscribe()
		client.teardown()
	} catch (error) {
		console.error('Error:', error)
		client.teardown()
	}
}

// Example of handling streaming with custom callbacks
export async function streamingExample() {
	const client = new WebLLMClient()

	try {
		await client.loadModel('Llama-3.1-8B-Instruct-q4f32_1-MLC')

		const messages: ChatCompletionMessage[] = [
			{ role: 'assistant', content: 'Write a short story about a robot.' },
		]

		// Subscribe to streaming updates
		const unsubscribe = client.subscribe((state) => {
			if (state.context.isStreaming) {
				// Update UI with streaming content
				console.log('Streaming:', state.context.streamedContent)
			}
		})

		const result = await client.startChat(messages, {
			stream: true,
			temperature: 0.9,
		})

		console.log('Final result:', result.content)
		unsubscribe()
		client.teardown()
	} catch (error) {
		console.error('Error:', error)
		client.teardown()
	}
}
