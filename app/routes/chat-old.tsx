import { createActor, type ActorRefFrom } from 'xstate'
import { useSelector } from '@xstate/react'
import { chatMachine } from '../lib/chat-machine-old'
import { type Route } from './+types/chat-old'
import { useAutoScroll } from '../lib/use-autoscroll'

// Not sure why, but we get type errors without the explicit return type 🤷‍♂️
export async function clientLoader(): Promise<{
	actor: ActorRefFrom<typeof chatMachine>
}> {
	const actor = createActor(chatMachine)
	actor.start()
	actor.send({ type: 'SET_LOGGING_ENABLED', enabled: false })

	// Trigger actual model loading by sending LOAD_MODEL event
	actor.send({
		type: 'LOAD_MODEL',
		modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
	})

	return { actor }
}

export default function Chat({ loaderData }: Route.ComponentProps) {
	const { actor } = loaderData
	const { containerRef, scrollTargetRef } = useAutoScroll()

	// Use selector to get state from the merged machine
	const state = useSelector(actor, (snapshot) => snapshot.context)
	const { messages, inputValue, isLoading, error, messageQueue } = state

	// Handle form submission
	return (
		<div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
			{/* Header */}
			<header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
				<div className="flex items-center justify-between">
					<div className="flex items-center space-x-4">
						<div>
							<h1 className="text-xl font-semibold text-gray-900 dark:text-white">
								Chat with WebLLM (Merged)
							</h1>
							<p className="text-sm text-gray-600 dark:text-gray-400">
								Using {state.modelId}
							</p>
						</div>
						{/* Loading indicator */}
						{state.isModelLoaded ? null : (
							<div className="flex items-center space-x-2 rounded-lg bg-blue-50 px-3 py-2 dark:bg-blue-900/20">
								<div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
								<span className="text-sm font-medium text-blue-700 dark:text-blue-300">
									Loading {state.modelLoadingProgress}%
								</span>
							</div>
						)}
					</div>
					<button
						onClick={() => actor.send({ type: 'CLEAR_CHAT' })}
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
			<div
				ref={containerRef}
				className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
			>
				{messages.length === 0 && (
					<div className="flex justify-center">
						<div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
							<p className="text-sm text-gray-600 dark:text-gray-400">
								Start a conversation by typing a message below.
							</p>
						</div>
					</div>
				)}

				{messages.map((message) => (
					<div
						key={message.id}
						className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
					>
						<div
							className={`max-w-sm rounded-lg px-4 py-2 lg:max-w-md ${
								message.role === 'user'
									? 'bg-blue-600 text-white'
									: message.role === 'tool'
										? 'border border-purple-200 bg-purple-50 text-gray-900 dark:border-purple-800 dark:bg-purple-900/20 dark:text-white'
										: 'border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
							}`}
						>
							<div className="flex items-center space-x-2">
								<p className="text-sm whitespace-pre-wrap">
									{message.role === 'tool' ? (
										<>
											<span className="font-medium text-purple-600 dark:text-purple-400">
												Tool Result:
											</span>{' '}
											{typeof message.content === 'string'
												? message.content
												: JSON.stringify(message.content, null, 2)}
										</>
									) : (
										message.content
									)}
								</p>
								{message.isStreaming ? (
									<span className="text-xs text-gray-500 dark:text-gray-400">
										<span className="inline-flex space-x-1">
											<span
												className="animate-bounce"
												style={{ animationDelay: '0ms' }}
											>
												•
											</span>
											<span
												className="animate-bounce"
												style={{ animationDelay: '150ms' }}
											>
												•
											</span>
											<span
												className="animate-bounce"
												style={{ animationDelay: '300ms' }}
											>
												•
											</span>
										</span>
									</span>
								) : null}
							</div>
							<p
								className={`mt-1 text-xs ${
									message.role === 'user'
										? 'text-blue-200'
										: message.role === 'tool'
											? 'text-purple-600 dark:text-purple-400'
											: 'text-gray-500 dark:text-gray-400'
								}`}
							>
								{message.role === 'tool'
									? 'Tool'
									: new Date(message.timestamp).toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit',
											hour12: true,
										})}
							</p>
						</div>
					</div>
				))}

				{/* Queued messages */}
				{messageQueue.length > 0 && (
					<div className="space-y-2">
						<div className="flex justify-center">
							<div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-1 dark:border-yellow-800 dark:bg-yellow-900/20">
								<p className="text-xs text-yellow-800 dark:text-yellow-200">
									{messageQueue.length} message
									{messageQueue.length > 1 ? 's' : ''} queued - will send when
									model loads
								</p>
							</div>
						</div>
						{messageQueue.map((content, index) => (
							<div key={`queued-${index}`} className="flex justify-end">
								<div className="max-w-sm rounded-lg bg-blue-600 px-4 py-2 text-white opacity-60 lg:max-w-md">
									<div className="flex items-center space-x-2">
										<p className="text-sm whitespace-pre-wrap">{content}</p>
										<span className="text-xs text-blue-200">(queued)</span>
									</div>
									<p className="mt-1 text-xs text-blue-200">
										Queued -{' '}
										{new Date().toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit',
											hour12: true,
										})}
									</p>
								</div>
							</div>
						))}
					</div>
				)}

				{/* Tool Approval UI */}
				{state.pendingToolCall && (
					<div className="flex justify-center">
						<div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-800 dark:bg-orange-900/20">
							<div className="mb-2">
								<p className="text-sm font-medium text-orange-800 dark:text-orange-200">
									Tool Call Pending Approval
								</p>
								<p className="text-xs text-orange-700 dark:text-orange-300">
									Tool:{' '}
									<span className="font-mono">
										{state.pendingToolCall.name}
									</span>
								</p>
								<p className="text-xs text-orange-700 dark:text-orange-300">
									Arguments:{' '}
									<span className="font-mono">
										{JSON.stringify(state.pendingToolCall.arguments)}
									</span>
								</p>
							</div>
							<div className="flex space-x-2">
								<button
									onClick={() => actor.send({ type: 'APPROVE_TOOL_EXECUTION' })}
									className="rounded bg-green-600 px-3 py-1 text-xs text-white transition-colors hover:bg-green-700 focus:ring-2 focus:ring-green-500"
								>
									Approve & Execute
								</button>
								<button
									onClick={() => actor.send({ type: 'REJECT_TOOL_EXECUTION' })}
									className="rounded bg-red-600 px-3 py-1 text-xs text-white transition-colors hover:bg-red-700 focus:ring-2 focus:ring-red-500"
								>
									Reject
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Invisible div for scrolling to bottom */}
				<div ref={scrollTargetRef} />
			</div>

			{/* Input Form */}
			<div className="border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
				<form
					onSubmit={(e) => {
						e.preventDefault()
						actor.send({ type: 'SEND_MESSAGE' })
					}}
					className="flex space-x-4"
				>
					<div className="flex-1">
						<input
							autoFocus
							type="text"
							name="message"
							value={inputValue}
							onChange={(e) =>
								actor.send({ type: 'SET_INPUT', value: e.currentTarget.value })
							}
							placeholder={
								messageQueue.length > 0
									? `Message will be queued (${messageQueue.length} already queued)...`
									: 'Type your message...'
							}
							className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
							disabled={isLoading}
						/>
					</div>
					<button
						type="submit"
						disabled={isLoading}
						className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isLoading
							? 'Sending...'
							: messageQueue.length > 0
								? `Queue (${messageQueue.length})`
								: 'Send'}
					</button>
				</form>
			</div>
		</div>
	)
}

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

export function meta() {
	return [
		{ title: 'Chat - React Router App' },
		{
			name: 'description',
			content: 'Chat with our AI assistant powered by WebLLM',
		},
	]
}
