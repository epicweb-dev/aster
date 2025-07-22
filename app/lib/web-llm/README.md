# WebLLM State Machine

A comprehensive XState v5 state machine for managing WebLLM model loading,
configuration, and chat completions with proper type safety and memory
management.

## Features

- **Type-safe state management** using XState v5 with setup
- **Model loading and configuration** with progress tracking
- **Streaming chat completions** with real-time updates
- **Memory leak prevention** with proper teardown
- **Error handling** with comprehensive error states
- **OpenAI API compatibility** for seamless integration

## Installation

```bash
npm install @mlc-ai/web-llm xstate
```

## Quick Start

```typescript
import { WebLLMClient } from './web-llm-example'

async function main() {
	const client = new WebLLMClient()

	try {
		// Load a model
		await client.loadModel('Llama-3.1-8B-Instruct-q4f32_1-MLC', {
			initProgressCallback: (progress) => {
				console.log('Loading progress:', progress)
			},
		})

		// Start a chat
		const messages = [
			{ role: 'assistant', content: 'You are a helpful AI assistant.' },
			{ role: 'assistant', content: 'Hello! How are you today?' },
		]

		const result = await client.startChat(messages, {
			temperature: 0.8,
			maxTokens: 500,
		})

		console.log('Response:', result.content)
		console.log('Usage:', result.usage)

		// Cleanup
		client.teardown()
	} catch (error) {
		console.error('Error:', error)
		client.teardown()
	}
}
```

## API Reference

### WebLLMClient

The main client class that wraps the state machine.

#### Constructor

```typescript
new WebLLMClient(modelId?: string)
```

#### Methods

##### `loadModel(modelId: string, engineConfig?: any, chatOpts?: any): Promise<void>`

Loads a WebLLM model with optional configuration.

```typescript
await client.loadModel('Llama-3.1-8B-Instruct-q4f32_1-MLC', {
	initProgressCallback: (progress) => {
		console.log('Progress:', progress)
	},
})
```

##### `startChat(messages: ChatCompletionMessage[], options?: ChatCompletionOptions): Promise<{ content: string; usage: any }>`

Starts a chat completion with streaming support.

```typescript
const result = await client.startChat(
	[{ role: 'assistant', content: 'Hello!' }],
	{
		temperature: 0.7,
		maxTokens: 1000,
		stream: true,
	},
)
```

##### `subscribe(callback: (state: any) => void): () => void`

Subscribe to state changes for real-time updates.

```typescript
const unsubscribe = client.subscribe((state) => {
	if (state.context.isStreaming) {
		console.log('Streaming:', state.context.streamedContent)
	}
})

// Later...
unsubscribe()
```

##### `clearChat(): void`

Clears the current chat history.

##### `teardown(): void`

Properly cleans up resources and prevents memory leaks.

##### `reset(): void`

Resets the state machine to its initial state.

##### `getState(): any`

Gets the current state snapshot.

## State Machine States

### `idle`

Initial state. Ready to load a model.

### `loading`

Model is being loaded. Tracks loading progress.

### `ready`

Model is loaded and ready for chat completions.

### `chatting`

Currently processing a chat completion with streaming.

### `error`

An error occurred. Can retry loading or reset.

### `tearingDown`

Cleaning up resources before returning to idle.

## Events

### `LOAD_MODEL`

Loads a new model.

```typescript
{
  type: 'LOAD_MODEL',
  modelId: string,
  engineConfig?: any,
  chatOpts?: any
}
```

### `START_CHAT`

Starts a chat completion.

```typescript
{
  type: 'START_CHAT',
  messages: ChatCompletionMessage[],
  options?: ChatCompletionOptions
}
```

### `CLEAR_CHAT`

Clears the current chat history.

### `TEARDOWN`

Initiates cleanup and teardown.

### `RESET`

Resets the machine to initial state.

## Streaming Example

```typescript
const client = new WebLLMClient()

// Subscribe to streaming updates
const unsubscribe = client.subscribe((state) => {
	if (state.context.isStreaming) {
		// Update UI with streaming content
		console.log('Streaming:', state.context.streamedContent)
	}
})

await client.loadModel('Llama-3.1-8B-Instruct-q4f32_1-MLC')

const result = await client.startChat(
	[{ role: 'assistant', content: 'Write a story.' }],
	{
		stream: true,
		temperature: 0.9,
	},
)

console.log('Final result:', result.content)
unsubscribe()
client.teardown()
```

## Error Handling

The state machine provides comprehensive error handling:

```typescript
const client = new WebLLMClient()

try {
	await client.loadModel('invalid-model')
} catch (error) {
	console.error('Model loading failed:', error.message)

	// Check current state
	const state = client.getState()
	if (state.matches('error')) {
		console.log('Error details:', state.context.error)
	}
}
```

## Memory Management

Always call `teardown()` when you're done to prevent memory leaks:

```typescript
const client = new WebLLMClient()

try {
	// Use the client...
} finally {
	client.teardown()
}
```

## Supported Models

WebLLM supports various models including:

- Llama 3 (Llama-3.1-8B-Instruct-q4f32_1-MLC)
- Phi 3
- Gemma
- Mistral
- Qwen

Check the [WebLLM documentation](https://webllm.mlc.ai/docs/) for the complete
list of supported models.

## TypeScript Support

The state machine is fully typed with TypeScript:

```typescript
import type {
	WebLLMContext,
	WebLLMEvents,
	ChatCompletionOptions,
} from './web-llm-actor'
import type { ChatCompletionMessage } from '@mlc-ai/web-llm'
```

## Advanced Usage

### Custom Engine Configuration

```typescript
await client.loadModel(
	'Llama-3.1-8B-Instruct-q4f32_1-MLC',
	{
		initProgressCallback: (progress) => {
			console.log('Loading:', progress)
		},
		// Custom app config
		appConfig: {
			model_list: [
				// Custom model configuration
			],
		},
	},
	{
		// Custom chat options
		repetition_penalty: 1.01,
	},
)
```

### Multiple Chat Sessions

```typescript
const client = new WebLLMClient()
await client.loadModel('Llama-3.1-8B-Instruct-q4f32_1-MLC')

// First chat
const result1 = await client.startChat([
	{ role: 'assistant', content: 'Hello!' },
])

// Clear and start new chat
client.clearChat()
const result2 = await client.startChat([
	{ role: 'assistant', content: 'New conversation.' },
])

client.teardown()
```

## Troubleshooting

### Model Loading Issues

- Ensure the model ID is correct and supported
- Check network connectivity for model downloads
- Verify WebGPU support in the browser

### Memory Issues

- Always call `teardown()` when done
- Don't create multiple instances without cleanup
- Monitor memory usage in development tools

### Streaming Issues

- Ensure `stream: true` is set in options
- Subscribe to state changes for real-time updates
- Handle streaming errors appropriately

## License

This project is licensed under the MIT License.
