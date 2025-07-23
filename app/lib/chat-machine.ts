import { invariant } from '@epic-web/invariant'
import type { ChatOptions, MLCEngine, MLCEngineConfig } from '@mlc-ai/web-llm'
import { assign, fromPromise, setup } from 'xstate'
import { getErrorMessage } from './utils.js'

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
	ADD_MESSAGE: 'debug',
	START_GENERATION: 'debug',
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

const generatorActor = fromPromise(async (context) => {
	return {
		type: 'GENERATE_FINISHED',
		content: 'test-content',
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
		resetModelLoadProgress: assign({
			modelLoadProgress: () => ({ status: 'idle', value: 0 }) as const,
		}),
		setCurrentModelId: assign({
			currentModelId: ({ event }) => {
				invariantEvent(event, 'LOAD_MODEL')
				return event.modelId
			},
		}),
		setModelLoadProgress: assign({
			modelLoadProgress: ({ event }) => {
				invariantEvent(event, 'MODEL_LOAD_PROGRESS')
				return event.progress !== 1
					? ({ status: 'pending', value: event.progress } as const)
					: ({ status: 'success', value: event.progress } as const)
			},
		}),
		processQueuedMessages: ({ context, self }) => {
			if (context.queuedMessages.length === 0) {
				return
			}
			// move queued messages to messages
			context.messages = [...context.messages, ...context.queuedMessages]
			context.queuedMessages = []
			// start generating
			self.send({ type: 'START_GENERATION' })
		},
		addMessageToQueue: assign({
			queuedMessages: ({ event, context }) => {
				invariantEvent(event, 'ADD_MESSAGE')
				return [
					...context.queuedMessages,
					{
						id: crypto.randomUUID(),
						content: event.content,
						timestamp: new Date(),
						role: 'user',
					} as const,
				]
			},
		}),
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
					actions: ['setCurrentModelId'],
				},
			},
		},
		loadingModel: {
			entry: ['resetModelLoadProgress'],
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
					actions: ['setModelLoadProgress'],
				},
			},
		},
		ready: {
			entry: ['processQueuedMessages'],
			on: {
				ADD_MESSAGE: {
					actions: ['processQueuedMessages'],
				},
				START_GENERATION: {
					target: 'generating',
				},
			},
		},
		generating: {
			invoke: {
				src: 'generator',
				input: ({ context }) => ({
					engine: context.engine,
					messages: context.messages,
				}),
				events: {
					GENERATE_FINISHED: {
						target: 'ready',
					},
				},
			},
			on: {},
		},
	},
})

function invariantEvent<T extends ChatEvent['type']>(
	event: ChatEvent,
	type: T,
): asserts event is Extract<ChatEvent, { type: T }> {
	invariant(
		event.type === type,
		`${type} event expected, but received ${event.type}`,
	)
}
