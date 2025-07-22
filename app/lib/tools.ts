import { type ChatCompletionTool } from '@mlc-ai/web-llm'

type ToolCallback = (args: Record<string, any>) => Promise<any>

type ToolDefinition = {
	config: ChatCompletionTool
	callback: ToolCallback
}

const tools = new Map<string, ToolDefinition>()

export function defineTool(
	name: string,
	config: Omit<ChatCompletionTool, 'type'>,
	callback: ToolCallback,
): void {
	tools.set(name, {
		config: { type: 'function', ...config },
		callback,
	})
}

export async function invokeTool(
	name: string,
	args: Record<string, any>,
): Promise<any> {
	const tool = tools.get(name)
	if (!tool) {
		throw new Error(`Tool "${name}" not found`)
	}
	return await tool.callback(args)
}

export async function getAvailableTools(): Promise<Array<ChatCompletionTool>> {
	return Array.from(tools.values()).map((tool) => tool.config)
}

// Example usage - define the search tool
defineTool(
	'search',
	{
		function: {
			name: 'search',
			description: 'Search the web for information',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'The query to search for' },
				},
				required: ['query'],
			},
		},
	},
	async (args) => {
		// This is where you'd implement the actual search logic
		console.log('Searching for:', args.query)
		return { results: [] }
	},
)

// Weather tool
defineTool(
	'weather',
	{
		function: {
			name: 'weather',
			description: 'Get current weather information for a location',
			parameters: {
				type: 'object',
				properties: {
					location: { type: 'string', description: 'City name or coordinates' },
					units: {
						type: 'string',
						enum: ['celsius', 'fahrenheit'],
						description: 'Temperature units',
					},
				},
				required: ['location'],
			},
		},
	},
	async (args) => {
		console.log(
			'Getting weather for:',
			args.location,
			'in',
			args.units || 'celsius',
		)
		return { temperature: 22, condition: 'partly cloudy', humidity: 65 }
	},
)

// Calculator tool
defineTool(
	'calculate',
	{
		function: {
			name: 'calculate',
			description: 'Perform mathematical calculations',
			parameters: {
				type: 'object',
				properties: {
					expression: {
						type: 'string',
						description: 'Mathematical expression to evaluate',
					},
				},
				required: ['expression'],
			},
		},
	},
	async (args) => {
		console.log('Calculating:', args.expression)
		try {
			// Note: In production, use a safe math evaluation library
			const result = eval(args.expression)
			return { result, expression: args.expression }
		} catch (error) {
			return { error: 'Invalid expression' }
		}
	},
)

// Translator tool
defineTool(
	'translate',
	{
		function: {
			name: 'translate',
			description: 'Translate text between languages',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'Text to translate' },
					from: {
						type: 'string',
						description: 'Source language code (e.g., en, es, fr)',
					},
					to: { type: 'string', description: 'Target language code' },
				},
				required: ['text', 'to'],
			},
		},
	},
	async (args) => {
		console.log(
			'Translating:',
			args.text,
			'from',
			args.from || 'auto',
			'to',
			args.to,
		)
		return {
			translated: `[Translated: ${args.text}]`,
			from: args.from || 'auto',
			to: args.to,
		}
	},
)

// Image generator tool
defineTool(
	'generate-image',
	{
		function: {
			name: 'generate-image',
			description: 'Generate an image from a text description',
			parameters: {
				type: 'object',
				properties: {
					prompt: {
						type: 'string',
						description: 'Text description of the image to generate',
					},
					style: {
						type: 'string',
						enum: ['realistic', 'artistic', 'cartoon'],
						description: 'Image style',
					},
					size: {
						type: 'string',
						enum: ['small', 'medium', 'large'],
						description: 'Image size',
					},
				},
				required: ['prompt'],
			},
		},
	},
	async (args) => {
		console.log(
			'Generating image:',
			args.prompt,
			'style:',
			args.style || 'realistic',
		)
		return {
			image_url: 'https://example.com/generated-image.jpg',
			prompt: args.prompt,
			style: args.style || 'realistic',
		}
	},
)

// News tool
defineTool(
	'get-news',
	{
		function: {
			name: 'get-news',
			description: 'Get latest news articles by topic or category',
			parameters: {
				type: 'object',
				properties: {
					category: {
						type: 'string',
						enum: [
							'technology',
							'business',
							'sports',
							'entertainment',
							'science',
						],
						description: 'News category',
					},
					query: {
						type: 'string',
						description: 'Search term for news articles',
					},
					limit: {
						type: 'number',
						description: 'Number of articles to return (max 10)',
					},
				},
				required: [],
			},
		},
	},
	async (args) => {
		console.log(
			'Getting news for:',
			args.category || args.query,
			'limit:',
			args.limit || 5,
		)
		return {
			articles: [
				{ title: 'Sample News Article', url: 'https://example.com/news/1' },
			],
			count: 1,
		}
	},
)

// Calendar tool
defineTool(
	'calendar',
	{
		function: {
			name: 'calendar',
			description: 'Manage calendar events and appointments',
			parameters: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						enum: ['create', 'list', 'delete'],
						description: 'Calendar action to perform',
					},
					title: { type: 'string', description: 'Event title' },
					date: { type: 'string', description: 'Event date (YYYY-MM-DD)' },
					time: { type: 'string', description: 'Event time (HH:MM)' },
					description: { type: 'string', description: 'Event description' },
				},
				required: ['action'],
			},
		},
	},
	async (args) => {
		console.log('Calendar action:', args.action, args.title || '')
		if (args.action === 'create') {
			return { event_id: 'evt_123', status: 'created' }
		} else if (args.action === 'list') {
			return { events: [{ title: 'Sample Event', date: '2024-01-15' }] }
		}
		return { status: 'success' }
	},
)

// Email tool
defineTool(
	'send-email',
	{
		function: {
			name: 'send-email',
			description: 'Send an email message',
			parameters: {
				type: 'object',
				properties: {
					to: { type: 'string', description: 'Recipient email address' },
					subject: { type: 'string', description: 'Email subject' },
					body: { type: 'string', description: 'Email body content' },
					priority: {
						type: 'string',
						enum: ['low', 'normal', 'high'],
						description: 'Email priority',
					},
				},
				required: ['to', 'subject', 'body'],
			},
		},
	},
	async (args) => {
		console.log('Sending email to:', args.to, 'subject:', args.subject)
		return { message_id: 'msg_456', status: 'sent', recipient: args.to }
	},
)

// File operations tool
defineTool(
	'file-operations',
	{
		function: {
			name: 'file-operations',
			description: 'Perform file system operations',
			parameters: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						enum: ['read', 'write', 'delete', 'list'],
						description: 'File operation to perform',
					},
					path: { type: 'string', description: 'File path' },
					content: {
						type: 'string',
						description: 'Content to write (for write action)',
					},
				},
				required: ['action', 'path'],
			},
		},
	},
	async (args) => {
		console.log('File operation:', args.action, 'on path:', args.path)
		if (args.action === 'read') {
			return { content: 'Sample file content', size: 1024 }
		} else if (args.action === 'write') {
			return { status: 'written', bytes: args.content?.length || 0 }
		} else if (args.action === 'list') {
			return {
				files: ['file1.txt', 'file2.pdf'],
				directories: ['docs', 'images'],
			}
		}
		return { status: 'success' }
	},
)

// Database query tool
defineTool(
	'database-query',
	{
		function: {
			name: 'database-query',
			description: 'Execute database queries',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'SQL query to execute' },
					database: { type: 'string', description: 'Database name' },
					operation: {
						type: 'string',
						enum: ['select', 'insert', 'update', 'delete'],
						description: 'Query operation type',
					},
				},
				required: ['query', 'database'],
			},
		},
	},
	async (args) => {
		console.log('Database query:', args.operation, 'on', args.database)
		return {
			rows_affected: 1,
			result: [{ id: 1, name: 'Sample Record' }],
			execution_time: '0.05s',
		}
	},
)

// Code analysis tool
defineTool(
	'analyze-code',
	{
		function: {
			name: 'analyze-code',
			description: 'Analyze code for issues, complexity, and suggestions',
			parameters: {
				type: 'object',
				properties: {
					code: { type: 'string', description: 'Code to analyze' },
					language: { type: 'string', description: 'Programming language' },
					analysis_type: {
						type: 'string',
						enum: ['lint', 'complexity', 'security', 'performance'],
						description: 'Type of analysis',
					},
				},
				required: ['code', 'language'],
			},
		},
	},
	async (args) => {
		console.log(
			'Analyzing',
			args.language,
			'code for',
			args.analysis_type || 'general issues',
		)
		return {
			issues: [{ line: 5, message: 'Consider using const instead of let' }],
			complexity_score: 3,
			suggestions: ['Add error handling', 'Consider extracting function'],
		}
	},
)

// Social media tool
defineTool(
	'social-media',
	{
		function: {
			name: 'social-media',
			description: 'Post content to social media platforms',
			parameters: {
				type: 'object',
				properties: {
					platform: {
						type: 'string',
						enum: ['twitter', 'linkedin', 'facebook', 'instagram'],
						description: 'Social media platform',
					},
					content: { type: 'string', description: 'Content to post' },
					hashtags: { type: 'string', description: 'Comma-separated hashtags' },
					schedule: {
						type: 'string',
						description: 'Schedule time (YYYY-MM-DD HH:MM)',
					},
				},
				required: ['platform', 'content'],
			},
		},
	},
	async (args) => {
		console.log('Posting to', args.platform, ':', args.content)
		return {
			post_id: 'post_789',
			platform: args.platform,
			status: 'posted',
			url: `https://${args.platform}.com/post/post_789`,
		}
	},
)

// API testing tool
defineTool(
	'test-api',
	{
		function: {
			name: 'test-api',
			description: 'Test API endpoints and validate responses',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'API endpoint URL' },
					method: {
						type: 'string',
						enum: ['GET', 'POST', 'PUT', 'DELETE'],
						description: 'HTTP method',
					},
					headers: { type: 'string', description: 'JSON string of headers' },
					body: { type: 'string', description: 'Request body (for POST/PUT)' },
				},
				required: ['url', 'method'],
			},
		},
	},
	async (args) => {
		console.log('Testing API:', args.method, args.url)
		return {
			status_code: 200,
			response_time: '150ms',
			headers: { 'content-type': 'application/json' },
			body: { message: 'Success' },
		}
	},
)

export async function getTool(name: string) {
	return tools.get(name)?.config
}
