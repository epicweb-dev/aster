import { useChat } from '@ai-sdk/react'

export default function Chat() {
	const { messages, input, handleInputChange, handleSubmit } = useChat({
		api: '/api/chat',
	})

	return (
		<div className="flex h-screen flex-col bg-gray-50">
			{/* Header */}
			<div className="border-b border-gray-200 bg-white px-6 py-4">
				<h1 className="text-xl font-semibold text-gray-900">
					AI Chat Assistant
				</h1>
				<p className="mt-1 text-sm text-gray-600">Ask me anything!</p>
			</div>

			{/* Messages Container */}
			<div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
				{messages.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
								<svg
									className="h-8 w-8 text-blue-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
									/>
								</svg>
							</div>
							<h3 className="mb-2 text-lg font-medium text-gray-900">
								Start a conversation
							</h3>
							<p className="text-gray-600">
								Type a message below to begin chatting with the AI assistant.
							</p>
						</div>
					</div>
				) : (
					messages.map((message) => (
						<div
							key={message.id}
							className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
						>
							<div
								className={`max-w-xs rounded-lg px-4 py-2 lg:max-w-md ${
									message.role === 'user'
										? 'bg-blue-600 text-white'
										: 'border border-gray-200 bg-white text-gray-900'
								}`}
							>
								<div className="mb-1 text-sm font-medium">
									{message.role === 'user' ? 'You' : 'Assistant'}
								</div>
								<div className="text-sm leading-relaxed">{message.content}</div>
							</div>
						</div>
					))
				)}
			</div>

			{/* Input Form */}
			<div className="border-t border-gray-200 bg-white px-6 py-4">
				<form onSubmit={handleSubmit} className="flex space-x-4">
					<div className="flex-1">
						<input
							value={input}
							name="prompt"
							onChange={handleInputChange}
							placeholder="Type your message..."
							className="w-full rounded-lg border border-gray-300 px-4 py-3 transition-colors outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500"
						/>
					</div>
					<button
						type="submit"
						disabled={!input.trim()}
						className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Send
					</button>
				</form>
			</div>
		</div>
	)
}
