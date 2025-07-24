import { expect, test, describe, vi } from 'vitest'
import { chatReducer, initialChatState } from './chat-reducer'

// Mock web-llm module
vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: vi.fn(),
}))

// Mock search engine
vi.mock('./search-engine', () => ({
  search: vi.fn().mockResolvedValue([]),
}))

describe('useChat integration', () => {
  test('reducer should handle basic state transitions', () => {
    let state = initialChatState

    // Load model
    state = chatReducer(state, {
      type: 'LOAD_MODEL',
      payload: { modelId: 'test-model' }
    })
    expect(state.status).toBe('loadingModel')
    expect(state.currentModelId).toBe('test-model')

    // Add message while loading (should queue)
    state = chatReducer(state, {
      type: 'ADD_MESSAGE',
      payload: { content: 'Hello' }
    })
    expect(state.queuedMessages).toHaveLength(1)
    expect(state.queuedMessages[0].content).toBe('Hello')

    // Model load success (should process queue and start generation)
    const mockEngine = { mock: 'engine' } as any
    state = chatReducer(state, {
      type: 'MODEL_LOAD_SUCCESS',
      payload: { engine: mockEngine }
    })
    expect(state.status).toBe('generating')
    expect(state.messages).toHaveLength(2) // user + assistant
    expect(state.queuedMessages).toHaveLength(0)

    // Stream chunks
    state = chatReducer(state, {
      type: 'STREAM_CHUNK',
      payload: { chunk: 'Hello' }
    })
    state = chatReducer(state, {
      type: 'STREAM_CHUNK',
      payload: { chunk: ' world' }
    })
    expect(state.messages[1].content).toBe('Hello world')

    // Complete generation
    state = chatReducer(state, {
      type: 'GENERATION_COMPLETE'
    })
    expect(state.status).toBe('ready')
  })

  test('reducer should handle errors correctly', () => {
    let state = initialChatState

    // Load model
    state = chatReducer(state, {
      type: 'LOAD_MODEL',
      payload: { modelId: 'test-model' }
    })

    // Model load error
    const error = new Error('Load failed')
    state = chatReducer(state, {
      type: 'MODEL_LOAD_ERROR',
      payload: { error }
    })
    expect(state.status).toBe('idle')
    expect(state.lastError).toEqual({
      cause: 'Model Load Error',
      message: 'Load failed',
      stack: error.stack,
    })

    // Clear error
    state = chatReducer(state, {
      type: 'CLEAR_ERROR'
    })
    expect(state.lastError).toBeUndefined()
  })
})