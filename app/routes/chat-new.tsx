import { useEffect } from 'react'
import { useChat } from '../lib/use-chat'
import { useAutoScroll } from '../lib/use-autoscroll'

export default function ChatNew() {
  const { state, loadModel, addMessage, clearError } = useChat()
  const { containerRef, scrollTargetRef } = useAutoScroll()

  // Load model on mount
  useEffect(() => {
    loadModel('Llama-3.1-8B-Instruct-q4f32_1-MLC')
  }, [loadModel])

  // Handle form submission
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const formData = new FormData(form)
    const message = String(formData.get('message')).trim()

    if (message) {
      addMessage(message)
      form.reset()
    }
  }

  // Handle error dismissal
  function handleErrorDismiss() {
    clearError()
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                Chat Assistant (New)
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {state.currentModelId
                  ? `Using ${state.currentModelId}`
                  : 'No model loaded'}
              </p>
            </div>
            {/* Loading indicator */}
            {state.status === 'loadingModel' ? (
              <div className="flex items-center space-x-2 rounded-lg bg-blue-50 px-3 py-2 dark:bg-blue-900/20">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Loading {Math.round(state.modelLoadProgress.value * 100)}%
                </span>
              </div>
            ) : null}
            {/* State indicator */}
            {state.status === 'generating' ? (
              <div className="flex items-center space-x-2 rounded-lg bg-green-50 px-3 py-2 dark:bg-green-900/20">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent"></div>
                <span className="text-sm font-medium text-green-700 dark:text-green-300">
                  Generating response...
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Error Display */}
      {state.lastError ? (
        <div className="border border-red-200 bg-red-50 px-6 py-3 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-800 dark:text-red-200">
              {state.lastError.message}
            </p>
            <button
              onClick={handleErrorDismiss}
              className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {/* Messages */}
      <div
        ref={containerRef}
        className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
      >
        {state.messages.length === 0 &&
        state.queuedMessages.length === 0 &&
        state.status !== 'generating' ? (
          <div className="flex justify-center">
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Start a conversation by typing a message below.
              </p>
            </div>
          </div>
        ) : null}

        {state.messages.map((message) => (
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
                  {message.role === 'tool' && 'toolCall' in message ? (
                    <>
                      <span className="font-medium text-purple-600 dark:text-purple-400">
                        Tool: {message.toolCall.name}
                      </span>
                      <br />
                      <span className="text-xs">
                        Result: {message.toolCall.result || message.content}
                      </span>
                    </>
                  ) : (
                    message.content
                  )}
                </p>
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
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            </div>
          </div>
        ))}

        {/* Queued messages */}
        {state.queuedMessages.length > 0 ? (
          <div className="space-y-2">
            <div className="flex justify-center">
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-1 dark:border-yellow-800 dark:bg-yellow-900/20">
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  {state.queuedMessages.length} message
                  {state.queuedMessages.length > 1 ? 's' : ''} queued
                </p>
              </div>
            </div>
            {state.queuedMessages.map((message) => (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-sm rounded-lg bg-blue-600 px-4 py-2 text-white opacity-60 lg:max-w-md">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm whitespace-pre-wrap">
                      {message.content}
                    </p>
                    <span className="text-xs text-blue-200">(queued)</span>
                  </div>
                  <p className="mt-1 text-xs text-blue-200">
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Invisible div for scrolling to bottom */}
        <div ref={scrollTargetRef} />
      </div>

      {/* Input Form */}
      <div className="border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <form onSubmit={handleSubmit} className="flex space-x-4">
          <div className="flex-1">
            <input
              autoFocus
              type="text"
              name="message"
              placeholder={
                state.queuedMessages.length > 0
                  ? `Message will be queued (${state.queuedMessages.length} already queued)...`
                  : state.status === 'idle' || state.status === 'loadingModel'
                    ? 'Waiting for model to load...'
                    : 'Type your message...'
              }
              disabled={state.status === 'idle'}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            />
          </div>
          <button
            type="submit"
            disabled={state.status === 'idle'}
            className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.status === 'loadingModel'
              ? 'Queue'
              : state.queuedMessages.length > 0
                ? `Queue (${state.queuedMessages.length})`
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
    { title: 'Chat Assistant (New)' },
    {
      name: 'description',
      content: 'Chat with our AI assistant powered by WebLLM using useReducer',
    },
  ]
}