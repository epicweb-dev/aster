import { expect, test } from 'vitest'
import { consoleError } from '#tests/test-setup'
import { Actor, createActor, fromPromise } from 'xstate'
import { chatMachine } from './chat-machine'
import { waitFor, createDeferred } from '#tests/utils'
import type { MLCEngine } from '@mlc-ai/web-llm'

type ChatActorOptions = Parameters<typeof createActor<typeof chatMachine>>[1]
type ChatMachineActors = Parameters<
	(typeof chatMachine)['provide']
>[0]['actors']

function setupActor({
	actors,
	options,
}: {
	actors?: ChatMachineActors
	options?: ChatActorOptions
} = {}) {
	const mockedChatMachine = chatMachine.provide({
		actors: {
			modelLoader: fromPromise<MLCEngine, { modelId: string }>(async () => {
				// mock MLCEngine
				return {
					// TODO: mock MLCEngine
				} as MLCEngine
			}),
			...actors,
		},
	})
	const actor = createActor(mockedChatMachine, {
		...options,
		input: {
			initialLogLevel: options?.input?.initialLogLevel ?? 'silent',
		},
	})
	actor.start()
	return {
		actor,
		[Symbol.dispose]: () => actor.stop(),
	}
}

async function setupActorWithModel(
	modelId: string,
	...rest: Parameters<typeof setupActor>
) {
	using setup = setupActor(...rest)
	const { actor } = setup
	actor.send({ type: 'LOAD_MODEL', modelId })
	expect(actor.getSnapshot().value).toBe('loadingModel')

	await waitFor(() => expect(actor.getSnapshot().value).toBe('ready'))

	expect(actor.getSnapshot().context.modelLoadProgress).toStrictEqual({
		status: 'success',
		value: 1,
	})

	return setup
}

test('starts in idle state', () => {
	using setup = setupActor()
	const { actor } = setup
	expect(actor.getSnapshot().value).toBe('idle')
})

test('sets log level', () => {
	using setup = setupActor({ options: { input: { initialLogLevel: 'debug' } } })
	const { actor } = setup
	expect(actor.getSnapshot().context.logLevel).toBe('debug')
})

test('model load happy path', async () => {
	using setup = setupActor()
	const { actor } = setup
	actor.send({ type: 'LOAD_MODEL', modelId: 'test-model' })
	const progress = 0.5
	actor.send({ type: 'MODEL_LOAD_PROGRESS', progress })
	expect(actor.getSnapshot().context.modelLoadProgress).toStrictEqual({
		status: 'pending',
		value: progress,
	})
	expect(actor.getSnapshot().value).toBe('loadingModel')

	await waitFor(() => expect(actor.getSnapshot().value).toBe('ready'))

	expect(actor.getSnapshot().context.modelLoadProgress).toStrictEqual({
		status: 'success',
		value: 1,
	})
	expect(actor.getSnapshot().value).toBe('ready')
})

test('model load failure', async () => {
	const error = new Error('test-error', {
		cause: 'test-cause',
	})
	using setup = setupActor({
		actors: {
			modelLoader: fromPromise<MLCEngine, { modelId: string }>(async () => {
				throw error
			}),
		},
		options: { input: { initialLogLevel: 'error' } },
	})
	const { actor } = setup

	actor.send({ type: 'LOAD_MODEL', modelId: 'test-model' })
	expect(actor.getSnapshot().value).toBe('loadingModel')

	await waitFor(() => expect(actor.getSnapshot().value).toBe('idle'))

	expect(actor.getSnapshot().context.modelLoadProgress).toStrictEqual({
		status: 'error',
		value: 0,
	})

	expect(actor.getSnapshot().value).toBe('idle')
	expect(actor.getSnapshot().context.lastError).toStrictEqual({
		cause: error.cause,
		message: error.message,
		stack: error.stack,
	})
})

test('queues messages while waiting for model and moves them to messages once model has loaded and moves to generating state', async () => {
	using setup = setupActor()
	const { actor } = setup
	actor.send({ type: 'LOAD_MODEL', modelId: 'test-model' })
	expect(actor.getSnapshot().value).toBe('loadingModel')

	const content1 = 'test-message'
	const content2 = 'test-message-2'
	actor.send({
		type: 'ADD_MESSAGE',
		content: content1,
	})

	actor.send({
		type: 'ADD_MESSAGE',
		content: content2,
	})

	expect(actor.getSnapshot().context.queuedMessages).toStrictEqual([
		{
			id: expect.any(String),
			content: content1,
			timestamp: expect.any(Date),
			role: 'user',
		},
		{
			id: expect.any(String),
			content: content2,
			timestamp: expect.any(Date),
			role: 'user',
		},
	])
	expect(actor.getSnapshot().context.messages).toStrictEqual([])

	expect(actor.getSnapshot().value).toBe('loadingModel')

	await waitFor(() => expect(actor.getSnapshot().value).toBe('generating'))

	expect(actor.getSnapshot().context.queuedMessages).toStrictEqual([])
	expect(actor.getSnapshot().context.messages).toStrictEqual([
		{
			id: expect.any(String),
			content: content1,
			timestamp: expect.any(Date),
			role: 'user',
		},
		{
			id: expect.any(String),
			content: content2,
			timestamp: expect.any(Date),
			role: 'user',
		},
	])
})

// search-flow.test.ts

// 'processes a queued message and transitions from ready → searchingTools → ready on failure'

// 'processes a queued message and transitions from ready → searchingTools → generatingResponse on success'

// 'cancels tool search with INTERRUPT and restarts on retry'
