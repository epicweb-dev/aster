import { invariant } from '@epic-web/invariant'
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionMessageParam,
	ChatOptions,
	MLCEngine,
	MLCEngineConfig,
} from '@mlc-ai/web-llm'
import { assign, createActor, fromPromise, setup, type ActorRef } from 'xstate'
import { getErrorMessage, parseToolCall } from './utils.js'
import { search } from './search-engine.js'

/*
CURRENT TEST:


test('queues messages while waiting for model and moves them to messages once model has loaded and moves to generating state', () => {
	using setup = setupActor()
	const { actor } = setup
	actor.send({ type: 'LOAD_MODEL', modelId: 'test-model' })
	expect(actor.getSnapshot().value).toBe('loadingModel')

	const message1 = { role: 'user', content: 'test-message' }
	const message2 = { role: 'user', content: 'test-message-2' }
	actor.send({
		type: 'ADD_MESSAGE',
		message: message1,
	})

	actor.send({
		type: 'ADD_MESSAGE',
		message: message2,
	})

	expect(actor.getSnapshot().context.queuedMessages).toStrictEqual([
		message1,
		message2,
	])

	expect(actor.getSnapshot().value).toBe('loadingModel')

	actor.send({ type: 'MODEL_LOAD_FINISHED' })

	expect(actor.getSnapshot().value).toBe('generating')

	expect(actor.getSnapshot().context.messages).toStrictEqual([
		message1,
		message2,
	])
})

*/

export type BaseMessage = {
	id: string
	content: string
	timestamp: Date
}

export type UserMessage = BaseMessage & { role: 'user' }
export type AssistantMessage = BaseMessage & { role: 'assistant' }
export type SystemMessage = BaseMessage & { role: 'system' }
export type ToolMessage = BaseMessage & {
	role: 'tool'
	toolCall: {
		id: string
		name: string
		arguments: Record<string, any>
		result?: string
	}
}

export type Message =
	| UserMessage
	| AssistantMessage
	| SystemMessage
	| ToolMessage

export type ToolCall = {
	name: string
	arguments: Record<string, any>
}

export type ChatContext = {
	logLevel: 'silent' | 'debug' | 'info' | 'warn' | 'error'
	currentModelId?: string
	modelLoadProgress: {
		status: 'idle' | 'pending' | 'success' | 'error'
		value: number
	}
	lastError?: {
		cause: string
		message: string
		stack?: string
	}
	messages: Array<Message>
	queuedMessages: Array<Message>
	engine?: MLCEngine
	toolDescriptors: Array<ToolDescriptor>
	assistantMessageId?: string
	toolBoundaryId?: string
}

export type ChatEvent =
	| {
			type: 'LOAD_MODEL'
			modelId: string
			engineConfig?: MLCEngineConfig
			chatOpts?: ChatOptions
	  }
	| {
			type: 'MODEL_LOAD_PROGRESS'
			progress: number
	  }
	| {
			type: 'ADD_MESSAGE'
			content: string
	  }
	| {
			type: 'START_GENERATION'
	  }
	| {
			type: 'STREAM_CHUNK'
			chunk: string
	  }

const logLevels = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
} satisfies Record<ChatContext['logLevel'], number>

const eventLogLevels = {
	LOAD_MODEL: 'info',
	MODEL_LOAD_PROGRESS: 'debug',
	ADD_MESSAGE: 'info',
	START_GENERATION: 'info',
	STREAM_CHUNK: 'debug',
} satisfies Record<ChatEvent['type'], ChatContext['logLevel']>

const modelLoaderActor = fromPromise<
	MLCEngine,
	Omit<Extract<ChatEvent, { type: 'LOAD_MODEL' }>, 'type'>
>(async ({ input, self, signal }) => {
	try {
		const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

		// Create engine with progress callback
		const enginePromise = CreateMLCEngine(input.modelId, {
			initProgressCallback: (progress) => {
				debugger
				self.send({
					type: 'MODEL_LOAD_PROGRESS',
					progress: progress.progress,
				})
			},
		})

		let engine: MLCEngine | undefined

		const unloadEngine = () => engine?.unload()
		signal.addEventListener('abort', unloadEngine)
		enginePromise.finally(() => {
			signal.removeEventListener('abort', unloadEngine)
		})

		engine = await enginePromise
		return engine
	} catch (error) {
		console.error('Model load error', error)
		throw new Error(
			error instanceof Error ? error.message : 'Failed to load model',
		)
	}
})

export type ToolDescriptor = {
	id: string
	llmDescription: string
}

const toolSearcherActor = fromPromise<
	{ tools: Array<ToolDescriptor> },
	{ messages: Array<ChatCompletionMessageParam> }
>(async ({ input }) => {
	const searchResults = await search(
		removeMessagesAfterLastUserOrToolMessage(input.messages),
	)
	return {
		tools: searchResults.map((tool) => ({
			id: tool.id,
			llmDescription: tool.llmDescription,
		})),
	}
})

const generatorActor = fromPromise<
	void,
	{
		toolBoundaryId: string
		engine: MLCEngine
		messages: Array<ChatCompletionMessageParam>
		tools: Array<ToolDescriptor>
	}
>(async ({ input, self }) => {
	const messages: Array<ChatCompletionMessageParam> = []

	// Add system message with tool instructions if tools are available
	if (input.tools && input.tools.length > 0) {
		messages.push({
			role: 'system',
			content: `You are a helpful assistant that can use tools to help the user. Below is a list of tools available:

${input.tools.map((tool: any) => tool.llmDescription).join('\n')}

To call a tool, use this exact format:
[TOOL_CALL:${input.toolBoundaryId}]
{"name": "tool_name", "arguments": {"arg1": "value1"}}
[/TOOL_CALL:${input.toolBoundaryId}]

Only call tools when necessary to help the user.`,
		})
	} else {
		messages.push({
			role: 'system',
			content:
				'You are a helpful AI assistant. Be concise and friendly in your responses.',
		})
	}

	messages.push(...removeMessagesAfterLastUserOrToolMessage(input.messages))

	// Create streaming chat completion
	console.log('starting completion for messages', messages)
	debugger
	const stream = await input.engine.chat.completions.create({
		messages,
		stream: true,
		temperature: 0.7,
		max_tokens: 1000,
	})
	console.log('got stream')
	debugger

	for await (const chunk of stream) {
		const content = chunk.choices[0]?.delta?.content || ''
		if (content) {
			self.send({ type: 'STREAM_CHUNK', chunk: content })
		}
	}
})

export const chatMachine = setup({
	types: {
		context: {} as ChatContext,
		events: {} as ChatEvent,
		input: {} as { initialLogLevel?: ChatContext['logLevel'] },
	},
	actors: {
		modelLoader: modelLoaderActor,
		toolSearcher: toolSearcherActor,
		generator: generatorActor,
	},
	guards: {
		hasQueuedMessages: ({ context }) => context.queuedMessages.length > 0,
	},
	actions: {
		logAllEvents: ({ event, context }) => {
			const eventLogLevel = eventLogLevels[event.type]
			const eventLogLevelNumber = logLevels[eventLogLevel]
			const currentLogLevelNumber = logLevels[context.logLevel]
			if (eventLogLevelNumber >= currentLogLevelNumber) {
				// heh 😅
				const logFn = eventLogLevel === 'debug' ? 'log' : eventLogLevel
				console[logFn](`Event ${event.type} received:`, {
					event,
					context,
				})
			}
		},
		processQueuedMessages: ({ context, self }) => {
			if (context.queuedMessages.length === 0) return

			context.messages = [...context.messages, ...context.queuedMessages]
			context.queuedMessages = []

			self.send({ type: 'START_GENERATION' })
		},
		addMessageToQueue: ({ event, context }) => {
			invariantEvent(event, 'ADD_MESSAGE')
			context.queuedMessages.push({
				id: crypto.randomUUID(),
				content: event.content,
				timestamp: new Date(),
				role: 'user',
			})
		},
	},
}).createMachine({
	id: 'chat',
	initial: 'idle',
	context: ({ input }) => ({
		logLevel: input?.initialLogLevel ?? 'error',
		currentModelId: undefined,
		modelLoadProgress: {
			status: 'idle',
			value: 0,
		},
		messages: [],
		queuedMessages: [],
		toolDescriptors: [],
	}),
	always: {
		actions: ['logAllEvents'],
	},
	on: {
		ADD_MESSAGE: {
			actions: ['addMessageToQueue'],
		},
	},
	states: {
		idle: {
			on: {
				LOAD_MODEL: {
					target: 'loadingModel',
					actions: [assign({ currentModelId: ({ event }) => event.modelId })],
				},
			},
		},
		loadingModel: {
			entry: [
				assign({
					modelLoadProgress: () => ({ status: 'idle', value: 0 }) as const,
				}),
			],
			invoke: {
				src: 'modelLoader',
				input: ({ event }) => {
					invariantEvent(event, 'LOAD_MODEL')
					return event
				},
				onDone: [
					{
						actions: assign({
							engine: ({ event }) => event.output,
							modelLoadProgress: () => ({
								status: 'success',
								value: 1,
							}),
						}),
						target: 'ready',
					},
				],
				onError: {
					target: 'idle',
					actions: assign({
						modelLoadProgress: () => ({
							status: 'error',
							value: 0,
						}),
						lastError: ({ event: { error } }) =>
							error instanceof Error
								? {
										cause: getErrorMessage(error.cause) ?? 'Model Load Error',
										message: error.message,
										stack: error.stack,
									}
								: {
										cause: 'Model Load Error',
										message: getErrorMessage(error),
										stack: undefined,
									},
					}),
				},
			},
			on: {
				MODEL_LOAD_PROGRESS: {
					actions: [
						assign({
							modelLoadProgress: ({ event }) => {
								debugger
								return {
									status: 'pending',
									value: event.progress,
								}
							},
						}),
					],
				},
			},
		},
		ready: {
			entry: ['processQueuedMessages'],
			on: {
				ADD_MESSAGE: {
					actions: ['addMessageToQueue', 'processQueuedMessages'],
				},
				START_GENERATION: {
					target: 'generating',
				},
			},
		},
		generating: {
			initial: 'searchingTools',
			entry: [
				({ context }) => {
					const id = crypto.randomUUID()
					context.toolBoundaryId = crypto.randomUUID()
					context.assistantMessageId = id
					context.messages.push({
						id,
						role: 'assistant',
						content: '',
						timestamp: new Date(),
					})
				},
			],
			states: {
				searchingTools: {
					invoke: {
						src: 'toolSearcher',
						input: ({ context }) => ({
							messages: convertMessages(context.messages),
						}),
						onDone: {
							target: 'generatingResponse',
							actions: assign({
								toolDescriptors: ({ event }) => event.output.tools,
							}),
						},
					},
				},
				generatingResponse: {
					invoke: {
						src: 'generator',
						input: ({ context }) => {
							invariant(
								context.engine,
								'Cannot generate response. Engine not found.',
							)
							invariant(
								context.toolBoundaryId,
								'Cannot generate response. Tool boundary ID not found.',
							)

							return {
								toolBoundaryId: context.toolBoundaryId,
								engine: context.engine,
								messages: convertMessages(context.messages),
								tools: context.toolDescriptors,
							}
						},
						onDone: {
							target: '..ready',
						},
					},
					on: {
						STREAM_CHUNK: {
							actions: assign({
								messages: ({ event, context }) => {
									const assistantMessage = context.messages.find(
										(msg) => msg.id === context.assistantMessageId,
									)
									if (!assistantMessage) {
										throw new Error('Assistant message not found')
									}
									assistantMessage.content += event.chunk
									return context.messages
								},
							}),
						},
					},
				},
			},
			on: {},
		},
	},
})

function convertMessages(
	messages: Array<Message>,
): Array<ChatCompletionMessageParam> {
	return messages.map((msg) =>
		msg.role === 'tool'
			? {
					role: 'tool',
					content: msg.content,
					tool_call_id: msg.toolCall?.id,
				}
			: {
					role: msg.role,
					content: msg.content,
				},
	)
}

// Completion won't work if the last message is an assistant message
// and we add the assistant message to the array before starting the completion
// so we'll remove that here.

// find the last user/tool message, include everything up to that (including that message)
function removeMessagesAfterLastUserOrToolMessage<
	MessageType extends { role: string },
>(messages: Array<MessageType>) {
	const lastUserOrToolMessage = messages.findLastIndex((msg) =>
		['user', 'tool'].includes(msg.role),
	)
	if (lastUserOrToolMessage === -1) {
		return messages
	}
	return messages.slice(0, lastUserOrToolMessage + 1)
}

function invariantEvent<T extends ChatEvent['type']>(
	event: ChatEvent,
	type: T,
): asserts event is Extract<ChatEvent, { type: T }> {
	invariant(
		event.type === type,
		`${type} event expected, but received ${event.type}`,
	)
}
