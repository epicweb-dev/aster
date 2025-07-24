import { type Tool, type ToolSet } from 'ai'
import { z } from 'zod'

const weatherTool = {
	id: 'weather.get' as const,
	description: 'Get the current weather for a location',
	parameters: z.object({
		location: z.string().describe('The location to get the weather for'),
	}),
	execute: async (args) => {
		console.log('Getting weather for:', args.location)
		return {
			weather: 'sunny',
		}
	},
} satisfies Tool

export const tools = Object.fromEntries(
	[weatherTool].entries(),
) satisfies ToolSet
