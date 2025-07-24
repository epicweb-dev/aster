import type { MLCEngine } from '@mlc-ai/web-llm'
import { getErrorMessage } from './utils'

// Reuse message types from the existing chat machine
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

export type Message = UserMessage | AssistantMessage | SystemMessage | ToolMessage

export type ChatStatus = 'idle' | 'loadingModel' | 'ready' | 'generating'

export type ChatState = {
  status: ChatStatus
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
  assistantMessageId?: string
  toolBoundaryId?: string
}

export type ChatAction =
  | {
      type: 'LOAD_MODEL'
      payload: { modelId: string }
    }
  | {
      type: 'MODEL_LOAD_PROGRESS'
      payload: { progress: number }
    }
  | {
      type: 'MODEL_LOAD_SUCCESS'
      payload: { engine: MLCEngine }
    }
  | {
      type: 'MODEL_LOAD_ERROR'
      payload: { error: Error }
    }
  | {
      type: 'ADD_MESSAGE'
      payload: { content: string }
    }
  | {
      type: 'START_GENERATION'
    }
  | {
      type: 'STREAM_CHUNK'
      payload: { chunk: string }
    }
  | {
      type: 'GENERATION_COMPLETE'
    }
  | {
      type: 'GENERATION_ERROR'
      payload: { error: Error }
    }
  | {
      type: 'CLEAR_ERROR'
    }

export const initialChatState: ChatState = {
  status: 'idle',
  currentModelId: undefined,
  modelLoadProgress: {
    status: 'idle',
    value: 0,
  },
  messages: [],
  queuedMessages: [],
}

function createUserMessage(content: string): UserMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date(),
  }
}

function createAssistantMessage(): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date(),
  }
}

function processQueuedMessages(state: ChatState): ChatState {
  if (state.queuedMessages.length === 0) {
    return state
  }

  return {
    ...state,
    messages: [...state.messages, ...state.queuedMessages],
    queuedMessages: [],
  }
}

function startGeneration(state: ChatState): ChatState {
  const assistantMessage = createAssistantMessage()
  
  return {
    ...state,
    status: 'generating',
    messages: [...state.messages, assistantMessage],
    assistantMessageId: assistantMessage.id,
    toolBoundaryId: crypto.randomUUID(),
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'LOAD_MODEL':
      return {
        ...state,
        status: 'loadingModel',
        currentModelId: action.payload.modelId,
        modelLoadProgress: {
          status: 'pending',
          value: 0,
        },
        lastError: undefined,
      }

    case 'MODEL_LOAD_PROGRESS':
      return {
        ...state,
        modelLoadProgress: {
          status: 'pending',
          value: action.payload.progress,
        },
      }

    case 'MODEL_LOAD_SUCCESS': {
      const processedState = processQueuedMessages({
        ...state,
        status: 'ready',
        engine: action.payload.engine,
        modelLoadProgress: {
          status: 'success',
          value: 1,
        },
        lastError: undefined,
      })

      // If there are messages after processing queue, start generation
      if (processedState.messages.length > 0 && processedState.status === 'ready') {
        return startGeneration(processedState)
      }

      return processedState
    }

    case 'MODEL_LOAD_ERROR':
      return {
        ...state,
        status: 'idle',
        modelLoadProgress: {
          status: 'error',
          value: 0,
        },
        lastError: {
          cause: 'Model Load Error',
          message: action.payload.error.message,
          stack: action.payload.error.stack,
        },
      }

    case 'ADD_MESSAGE': {
      const userMessage = createUserMessage(action.payload.content)

      if (state.status === 'loadingModel') {
        // Queue message while loading
        return {
          ...state,
          queuedMessages: [...state.queuedMessages, userMessage],
        }
      }

      if (state.status === 'ready') {
        // Add message and start generation
        return startGeneration({
          ...state,
          messages: [...state.messages, userMessage],
        })
      }

      // For other states, just queue the message
      return {
        ...state,
        queuedMessages: [...state.queuedMessages, userMessage],
      }
    }

    case 'START_GENERATION':
      return startGeneration(state)

    case 'STREAM_CHUNK': {
      const assistantMessage = state.messages.find(
        (msg) => msg.id === state.assistantMessageId
      )

      if (!assistantMessage) {
        throw new Error('Assistant message not found')
      }

      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === state.assistantMessageId
            ? { ...msg, content: msg.content + action.payload.chunk }
            : msg
        ),
      }
    }

    case 'GENERATION_COMPLETE':
      return {
        ...state,
        status: 'ready',
        assistantMessageId: undefined,
      }

    case 'GENERATION_ERROR':
      return {
        ...state,
        status: 'ready',
        assistantMessageId: undefined,
        lastError: {
          cause: 'Generation Error',
          message: action.payload.error.message,
          stack: action.payload.error.stack,
        },
      }

    case 'CLEAR_ERROR':
      return {
        ...state,
        lastError: undefined,
      }

    default:
      return state
  }
}