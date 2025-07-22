import type { ToolDefinition } from './search-engine'

// Tool execution function type
export type ToolExecutor = (args: Record<string, unknown>) => Promise<string>

// Tool definition with execution logic
export type Tool = {
	definition: ToolDefinition
	executor: ToolExecutor
}

// Tool registry
export class ToolRegistry {
	private tools = new Map<string, Tool>()

	// Register a tool with its definition and executor
	register(
		name: string,
		definition: ToolDefinition,
		executor: ToolExecutor,
	): void {
		this.tools.set(name, { definition, executor })
	}

	// Get a tool by name
	get(name: string): Tool | undefined {
		return this.tools.get(name)
	}

	// Get all tool definitions (for search engine)
	getAllDefinitions(): ToolDefinition[] {
		return Array.from(this.tools.values()).map((tool) => tool.definition)
	}

	// Execute a tool
	async execute(name: string, args: Record<string, unknown>): Promise<string> {
		const tool = this.tools.get(name)
		if (!tool) {
			throw new Error(`Unknown tool: ${name}`)
		}
		return await tool.executor(args)
	}

	// Check if a tool exists
	has(name: string): boolean {
		return this.tools.has(name)
	}
}

// Create the global tool registry
export const toolRegistry = new ToolRegistry()

// Tool implementations
const tools = {
	// Alert tool
	alert: {
		definition: {
			name: 'alert',
			description: 'Display an alert message to the user',
			parameters: {
				type: 'object',
				properties: {
					message: {
						type: 'string',
						description: 'The message to display in the alert',
					},
				},
				required: ['message'],
			},
		},
		executor: async (args: Record<string, unknown>): Promise<string> => {
			const message = args.message as string
			alert(message)
			return `Alert displayed: ${message}`
		},
	},

	// File search tool
	file_search: {
		definition: {
			name: 'file_search',
			description: 'Search for files in the codebase using fuzzy matching',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The search query to find files',
					},
				},
				required: ['query'],
			},
		},
		executor: async (args: Record<string, unknown>): Promise<string> => {
			const query = args.query as string
			// TODO: Implement actual file search functionality
			return `File search for "${query}" - This would execute the file_search tool`
		},
	},

	// Codebase search tool
	codebase_search: {
		definition: {
			name: 'codebase_search',
			description: 'Search for code snippets and functions in the codebase',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The search query for code',
					},
					target_directories: {
						type: 'array',
						items: { type: 'string' },
						description: 'Optional directories to search in',
					},
				},
				required: ['query'],
			},
		},
		executor: async (args: Record<string, unknown>): Promise<string> => {
			const query = args.query as string
			const targetDirectories = args.target_directories as string[] | undefined
			// TODO: Implement actual codebase search functionality
			return `Codebase search for "${query}"${targetDirectories ? ` in ${targetDirectories.join(', ')}` : ''} - This would execute the codebase_search tool`
		},
	},

	// Read file tool
	read_file: {
		definition: {
			name: 'read_file',
			description: 'Read the contents of a specific file',
			parameters: {
				type: 'object',
				properties: {
					target_file: {
						type: 'string',
						description: 'The path of the file to read',
					},
					start_line_one_indexed: {
						type: 'number',
						description: 'Starting line number (optional)',
					},
					end_line_one_indexed_inclusive: {
						type: 'number',
						description: 'Ending line number (optional)',
					},
				},
				required: ['target_file'],
			},
		},
		executor: async (args: Record<string, unknown>): Promise<string> => {
			const targetFile = args.target_file as string
			const startLine = args.start_line_one_indexed as number | undefined
			const endLine = args.end_line_one_indexed_inclusive as number | undefined
			// TODO: Implement actual file reading functionality
			return `Reading file "${targetFile}"${startLine ? ` from line ${startLine}` : ''}${endLine ? ` to line ${endLine}` : ''} - This would execute the read_file tool`
		},
	},

	// Edit file tool
	edit_file: {
		definition: {
			name: 'edit_file',
			description: 'Create or edit a file with new content',
			parameters: {
				type: 'object',
				properties: {
					target_file: {
						type: 'string',
						description: 'The path of the file to create or edit',
					},
					instructions: {
						type: 'string',
						description: 'Instructions for the edit',
					},
					code_edit: {
						type: 'string',
						description: 'The new code content',
					},
				},
				required: ['target_file', 'instructions', 'code_edit'],
			},
		},
		executor: async (args: Record<string, unknown>): Promise<string> => {
			const targetFile = args.target_file as string
			const instructions = args.instructions as string
			const codeEdit = args.code_edit as string
			// TODO: Implement actual file editing functionality
			return `Editing file "${targetFile}" with instructions: "${instructions}" - This would execute the edit_file tool`
		},
	},

	// Run terminal command tool
	run_terminal_cmd: {
		definition: {
			name: 'run_terminal_cmd',
			description: 'Execute a terminal command',
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: 'The command to execute',
					},
					is_background: {
						type: 'boolean',
						description: 'Whether to run the command in the background',
					},
				},
				required: ['command'],
			},
		},
		executor: async (args: Record<string, unknown>): Promise<string> => {
			const command = args.command as string
			const isBackground = args.is_background as boolean | undefined
			// TODO: Implement actual terminal command execution
			return `Running command "${command}"${isBackground ? ' in background' : ''} - This would execute the run_terminal_cmd tool`
		},
	},
}

// Register all tools
Object.entries(tools).forEach(([name, tool]) => {
	toolRegistry.register(name, tool.definition, tool.executor)
})

// Export the registry and types for use in other files
export { toolRegistry as default }
