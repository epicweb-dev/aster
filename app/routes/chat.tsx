import { useChat as useChatBase } from '@ai-sdk/react'
import type { ToolInvocation, UIMessage } from 'ai'
import { createContext, use } from 'react'
import { tools } from '#app/lib/tools'
import {
	APPROVAL,
	getToolsRequiringConfirmation,
} from '#app/lib/human-in-the-loop-utils'

const ChatContext = createContext<ReturnType<typeof useChatBase> | null>(null)

function ChatProvider({ children }: { children: React.ReactNode }) {
	const chat = useChatBase({
		api: '/api/chat',
	})

	return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>
}

function useChat() {
	const chat = use(ChatContext)
	if (!chat) {
		throw new Error('useChat must be used within a ChatProvider')
	}
	return chat
}

function Chat() {
	const { messages, input, handleInputChange, handleSubmit, error } = useChat()
	const toolsRequiringConfirmation = getToolsRequiringConfirmation(tools)

	// Used to disable input while confirmation is pending
	const pendingToolCallConfirmation = messages.some((m: UIMessage) =>
		m.parts?.some(
			(part) =>
				part.type === 'tool-invocation' &&
				part.toolInvocation.state === 'call' &&
				toolsRequiringConfirmation.includes(part.toolInvocation.toolName),
		),
	)

	return (
		<div className="bg-muted flex h-screen flex-col">
			{/* Header */}
			<div className="border-border bg-background border-b px-6 py-4">
				<h1 className="text-foreground text-xl font-semibold">Aster Chat</h1>
				<p className="text-muted-foreground mt-1 text-sm">Ask me anything!</p>
			</div>

			{/* Messages Container */}
			<div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
				{messages.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<div className="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
								<svg
									className="text-primary h-8 w-8"
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
							<h3 className="text-foreground mb-2 text-lg font-medium">
								Start a conversation
							</h3>
							<p className="text-muted-foreground">
								Type a message below to begin chatting with Aster.
							</p>
						</div>
					</div>
				) : (
					messages.map((message) => (
						<Message key={message.id} message={message} />
					))
				)}
				{error ? (
					<div className="bg-danger text-danger-foreground rounded-lg p-4">
						{error.message}
					</div>
				) : null}
			</div>

			{/* Input Form */}
			<div className="border-border bg-background border-t px-6 py-4">
				<form onSubmit={handleSubmit} className="flex space-x-4">
					<div className="flex-1">
						<input
							autoFocus
							value={input}
							name="prompt"
							onChange={handleInputChange}
							placeholder="Type your message..."
							disabled={pendingToolCallConfirmation}
							className="bg-input text-input-foreground focus:border-ring focus:ring-ring w-full rounded-lg border px-4 py-3 transition-colors outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
						/>
					</div>
					<button
						type="submit"
						disabled={!input.trim() || pendingToolCallConfirmation}
						className="bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-ring rounded-lg px-6 py-3 font-medium transition-colors focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Send
					</button>
				</form>
			</div>
		</div>
	)
}

function Message({ message }: { message: UIMessage }) {
	return (
		<div
			key={message.id}
			className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
		>
			<div
				className={`max-w-xs rounded-lg px-4 py-2 lg:max-w-md ${
					message.role === 'user'
						? 'bg-primary text-primary-foreground'
						: 'border-border bg-background text-foreground border'
				}`}
			>
				<div className="mb-1 text-sm font-medium">
					{message.role === 'user' ? 'You' : 'Assistant'}
				</div>
				<div className="text-sm leading-relaxed">
					{message.parts?.map((part, i) => {
						switch (part.type) {
							case 'text':
								return <div key={i}>{part.text}</div>
							case 'tool-invocation':
								return (
									<ToolInvocation key={i} invocation={part.toolInvocation} />
								)
							default:
								return null
						}
					})}
				</div>
			</div>
		</div>
	)
}

function ToolInvocation({ invocation }: { invocation: ToolInvocation }) {
	const { addToolResult } = useChat()
	const { toolName, state, args, toolCallId } = invocation
	const toolsRequiringConfirmation = getToolsRequiringConfirmation(tools)
	const dynamicInfoStyles = 'font-mono bg-muted p-1 text-sm'

	// Render confirmation UI for tools that require confirmation
	if (toolsRequiringConfirmation.includes(toolName) && state === 'call') {
		return (
			<div className="text-muted-foreground mt-2">
				Run <span className={dynamicInfoStyles}>{toolName}</span> with args:{' '}
				<span className={dynamicInfoStyles}>{JSON.stringify(args)}</span>
				<div className="flex gap-2 pt-2">
					<button
						className="bg-success text-success-foreground hover:bg-success/90 rounded px-4 py-2 font-bold"
						onClick={() =>
							addToolResult({
								toolCallId,
								result: APPROVAL.YES,
							})
						}
					>
						Yes
					</button>
					<button
						className="bg-danger text-danger-foreground hover:bg-danger/90 rounded px-4 py-2 font-bold"
						onClick={() =>
							addToolResult({
								toolCallId,
								result: APPROVAL.NO,
							})
						}
					>
						No
					</button>
				</div>
			</div>
		)
	}

	// Show tool result
	if (state === 'result' && invocation.result) {
		return (
			<div className="bg-muted mt-2 rounded p-2 text-sm">
				<strong>Tool Result:</strong> {invocation.result}
			</div>
		)
	}

	return null
}

export default function ChatPage() {
	return (
		<ChatProvider>
			<Chat />
		</ChatProvider>
	)
}

export function meta() {
	return [
		{
			title: 'Aster Chat',
		},
	]
}
