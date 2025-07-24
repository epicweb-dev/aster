# Tool Call Implementation

This document describes the implementation of tool call functionality using test-driven development (TDD).

## Features Implemented

### 1. Tool Call Parsing ✅
- **Location**: `app/lib/utils.ts` - `parseToolCall()` function
- **Functionality**: Parses tool calls from streamed content using the format `[TOOL_CALL:boundaryId]{"name": "toolName", "arguments": {...}}[/TOOL_CALL:boundaryId]`
- **Tests**: 18 tests in `app/lib/utils.test.ts` covering various edge cases

### 2. Streaming Buffer Management ✅
- **Location**: `app/lib/chat-reducer.ts` - Enhanced `STREAM_CHUNK` handler
- **Functionality**: 
  - Detects potential tool calls during streaming
  - Buffers content that looks like tool calls to prevent premature output
  - Intelligently flushes buffer when it's clear content is not a tool call
  - Handles partial tool calls that never complete
- **Key Features**:
  - Extracts content before tool calls and streams it normally
  - Buffers only the tool call portion
  - Uses heuristics to detect when buffered content is not a real tool call
  - Flushes buffer on patterns like natural language, punctuation, or excessive length

### 3. User Approval Flow ✅
- **Location**: `app/lib/chat-reducer.ts` - New action handlers
- **States Added**:
  - `awaitingToolApproval`: When a tool call is detected and needs user approval
  - `executingTool`: When tool is being executed after approval
- **Actions Added**:
  - `PENDING_TOOL_CALL`: Triggered when a complete tool call is detected
  - `APPROVE_TOOL_CALL`: User approves the tool execution
  - `REJECT_TOOL_CALL`: User rejects the tool call (content is added back to message)

### 4. Tool Execution ✅
- **Location**: `app/lib/use-chat.ts` - New useEffect for tool execution
- **Functionality**:
  - Automatically executes approved tools using `invokeTool()` from `app/lib/tools.ts`
  - Handles both successful execution and errors
  - Creates tool messages with results
  - Starts new assistant message generation after tool completion
- **Actions Added**:
  - `TOOL_EXECUTION_SUCCESS`: Tool executed successfully
  - `TOOL_EXECUTION_ERROR`: Tool execution failed

### 5. Enhanced useChat Hook ✅
- **New Functions**:
  - `approveToolCall()`: Approve pending tool call
  - `rejectToolCall()`: Reject pending tool call
- **State Extensions**:
  - `pendingToolCall`: Current tool call awaiting approval
  - `bufferedToolContent`: Content that was buffered during tool call detection
  - `streamBuffer`: Current streaming buffer for potential tool calls

## State Flow

```
generating -> (tool call detected) -> awaitingToolApproval
                                           |
                                           v
                                    [user decision]
                                     /           \
                            approve/              \reject
                               |                   |
                               v                   v
                        executingTool      generating (content restored)
                               |
                               v
                        [tool execution]
                         /           \
                   success/           \error
                        |               |
                        v               v
                 generating (with tool result message)
```

## Message Types

### ToolMessage
```typescript
type ToolMessage = BaseMessage & {
  role: 'tool'
  toolCall: {
    id: string
    name: string
    arguments: Record<string, any>
    result?: string
  }
}
```

## Testing

### Test Coverage
- **48 total tests** across 4 test files
- **21 tests** in `chat-reducer.test.ts` - Core reducer functionality
- **6 tests** in `use-chat.test.ts` - Hook integration and streaming
- **18 tests** in `utils.test.ts` - Tool call parsing
- **3 tests** in `tool-integration.test.ts` - End-to-end workflows

### Key Test Scenarios
1. **Basic tool call detection and buffering during streaming**
2. **Partial tool calls that are not complete (false positives)**
3. **Complete tool call workflow from detection to execution**
4. **Tool call rejection and content restoration**
5. **Tool execution errors**
6. **Multiple tool calls in sequence**
7. **Edge cases in tool call parsing**

## Usage Example

```typescript
const { state, approveToolCall, rejectToolCall } = useChat()

// Check if there's a pending tool call
if (state.status === 'awaitingToolApproval' && state.pendingToolCall) {
  // Show approval UI
  console.log(`Tool call: ${state.pendingToolCall.name}`)
  console.log(`Arguments:`, state.pendingToolCall.arguments)
  
  // User can approve or reject
  approveToolCall() // or rejectToolCall()
}

// Check tool execution status
if (state.status === 'executingTool') {
  console.log('Tool is executing...')
}

// Access tool results in messages
const toolMessages = state.messages.filter(msg => msg.role === 'tool')
```

## Key Implementation Details

### Streaming Intelligence
- Uses pattern matching to detect tool call starts: `[TOOL_CALL:`
- Buffers content until tool call completion or determination it's not a tool call
- Heuristics for false positive detection:
  - Natural language patterns (spaces + lowercase words)
  - Punctuation that wouldn't appear in tool calls
  - Excessive length without proper structure

### Error Handling
- Graceful handling of malformed tool calls
- Tool execution errors are converted to tool messages with error content
- Buffer flushing ensures no content is lost

### State Management
- Clean separation of concerns between detection, approval, and execution
- Proper state transitions with clear status indicators
- Queue processing integration for seamless user experience

## Running Tests

```bash
npm test -- --no-watch
```

All tests pass, ensuring the implementation is robust and handles edge cases correctly.