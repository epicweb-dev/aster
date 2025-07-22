import React from 'react'
import { Suspense, useEffect, useState } from 'react'
import { Await } from 'react-router'
import { createActor, type ActorRefFrom } from 'xstate'
import { useActorRef, useMachine, useSelector } from '@xstate/react'
import { useActor } from '@xstate/react'
import { chatParentMachine } from '../lib/chat-parent-machine'
import { type Route } from './+types/chat-new'

// Loading component that shows progress
function ChatLoading({
	progress,
	error,
}: {
	progress: number
	error: string | null
}) {
	return (
		<div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
			<div className="text-center">
				<div className="mb-4 flex justify-center">
					<div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
				</div>
				<p className="text-lg font-medium text-gray-900 dark:text-white">
					Loading WebLLM... {progress}%
				</p>
				{error ? (
					<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
				) : (
					<p className="text-sm text-gray-600 dark:text-gray-400">
						Initializing the AI model
					</p>
				)}
			</div>
		</div>
	)
}

// HydrateFallback component that renders immediately on initial page load
export function HydrateFallback() {
	return (
		<div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
			<div className="text-center">
				<div className="mb-4 flex justify-center">
					<div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
				</div>
				<p className="text-lg font-medium text-gray-900 dark:text-white">
					Initializing Chat...
				</p>
				<p className="text-sm text-gray-600 dark:text-gray-400">
					Setting up the AI model for conversation
				</p>
			</div>
		</div>
	)
}

// Not sure why, but we get type errors without the explicit return type 🤷‍♂️
export async function clientLoader(): Promise<{
	actor: ActorRefFrom<typeof chatParentMachine>
	readyPromise: Promise<ActorRefFrom<typeof chatParentMachine>>
}> {
	const actor = createActor(chatParentMachine)
	actor.start()

	// Trigger actual model loading by sending LOAD_MODEL event
	actor.send({
		type: 'LOAD_MODEL',
		modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
	})

	// Promise that resolves when the model is loaded
	const readyPromise = new Promise<ActorRefFrom<typeof chatParentMachine>>(
		(resolve, reject) => {
			const subscription = actor.subscribe((snapshot: any) => {
				if (snapshot.matches('idle')) {
					subscription.unsubscribe()
					resolve(actor)
				} else if (snapshot.matches('error')) {
					subscription.unsubscribe()
					reject(new Error(snapshot.context.error || 'Failed to load model'))
				}
			})
		},
	)

	return { actor, readyPromise }
}

function ChatComponent({
	actor,
}: {
	actor: ActorRefFrom<typeof chatParentMachine>
}) {
	// Use 'as any' to satisfy the type system for useActor
	const state = useSelector(actor, (state) => state.context)
	const {
		messages,
		inputValue,
		isLoading,
		isStreaming,
		streamedContent,
		error,
	} = state

	// Handle form submission
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		if (!inputValue.trim()) return
		actor.send({ type: 'SEND_MESSAGE' })
	}

	// Handle input change
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		actor.send({ type: 'SET_INPUT', value: e.target.value } as any)
	}

	// Handle clear chat
	const handleClearChat = () => {
		actor.send({ type: 'CLEAR_CHAT' })
	}

	return (
		<div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
			{/* Header */}
			<header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-xl font-semibold text-gray-900 dark:text-white">
							Chat with WebLLM
						</h1>
						<p className="text-sm text-gray-600 dark:text-gray-400">
							Powered by XState v5 and React Router v7
						</p>
					</div>
					<button
						onClick={handleClearChat}
						className="rounded-lg bg-gray-600 px-4 py-2 text-white transition-colors hover:bg-gray-700 focus:ring-2 focus:ring-gray-500"
					>
						Clear Chat
					</button>
				</div>
			</header>

			{/* Error Display */}
			{error && (
				<div className="border border-red-200 bg-red-50 px-6 py-3 dark:border-red-800 dark:bg-red-900/20">
					<p className="text-sm text-red-800 dark:text-red-200">{error}</p>
				</div>
			)}

			{/* Messages */}
			<div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
				{messages.length === 0 && (
					<div className="flex justify-center">
						<div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
							<p className="text-sm text-gray-600 dark:text-gray-400">
								Start a conversation by typing a message below.
							</p>
						</div>
					</div>
				)}

				{messages.map((message: any) => (
					<div
						key={message.id}
						className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
					>
						<div
							className={`max-w-xs rounded-lg px-4 py-2 lg:max-w-md ${
								message.role === 'user'
									? 'bg-blue-600 text-white'
									: 'border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
							}`}
						>
							<p className="text-sm whitespace-pre-wrap">{message.content}</p>
							<p
								className={`mt-1 text-xs ${
									message.role === 'user'
										? 'text-blue-200'
										: 'text-gray-500 dark:text-gray-400'
								}`}
							>
								{new Date(message.timestamp).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit',
									hour12: true,
								})}
							</p>
						</div>
					</div>
				))}

				{/* Streaming assistant message */}
				{isStreaming && (
					<div className="flex justify-start">
						<div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
							<div className="flex items-center space-x-2">
								<span className="text-sm whitespace-pre-wrap">
									{streamedContent}
								</span>
								<span className="text-xs text-gray-500 dark:text-gray-400">
									...
								</span>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Input Form */}
			<div className="border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
				<form onSubmit={handleSubmit} className="flex space-x-4">
					<div className="flex-1">
						<input
							type="text"
							name="message"
							value={inputValue}
							onChange={handleInputChange}
							placeholder="Type your message..."
							className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
							disabled={isLoading}
						/>
					</div>
					<button
						type="submit"
						disabled={isLoading}
						className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isLoading ? 'Sending...' : 'Send'}
					</button>
				</form>
			</div>
		</div>
	)
}

// Main component with Suspense and Await
export default function ChatNew({ loaderData }: Route.ComponentProps) {
	const { actor, readyPromise } = loaderData
	const [progress, setProgress] = useState(0)
	const [error, setError] = useState<string | null>(null)

	// Subscribe to loading progress from the machine
	useEffect(() => {
		const subscription = actor.subscribe((state) => {
			setProgress(state.context.modelLoadingProgress)
			setError(state.context.error)
		})
		return () => {
			subscription.unsubscribe()
		}
	}, [actor])

	return (
		<Suspense fallback={<ChatLoading progress={progress} error={error} />}>
			<Await resolve={readyPromise}>
				{(resolvedActor: ActorRefFrom<typeof chatParentMachine>) => (
					<ChatComponent actor={resolvedActor} />
				)}
			</Await>
		</Suspense>
	)
}
