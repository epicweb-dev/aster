import { type Route } from './+types/chat'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, createDataStreamResponse, type Message } from 'ai'
import { z } from 'zod'
import { tools } from '#app/lib/tools'
import { processToolCalls } from '#app/lib/human-in-the-loop-utils'

const RequestSchema = z.object({
	id: z.string().optional(),
	messages: z.array(
		z.object({
			id: z.string().optional(),
			role: z.enum(['user', 'assistant']),
			content: z.string(),
			parts: z.array(z.any()).optional(),
		}),
	),
})

export async function action({ request, context }: Route.ActionArgs) {
	const rawBody = await request.json()
	const { messages } = RequestSchema.parse(rawBody)

	const anthropic = createAnthropic({
		apiKey: context.cloudflare.env.ANTHROPIC_API_KEY,
	})

	return createDataStreamResponse({
		execute: async (dataStream) => {
			// Process tool calls that require human confirmation
			const processedMessages = await processToolCalls(
				{
					messages: messages as Message[],
					dataStream,
					tools,
				},
				{
					// type-safe object for tools without an execute function
					getWeatherInformation: async ({ city }) => {
						const conditions = ['sunny', 'cloudy', 'rainy', 'snowy']
						return `The weather in ${city} is ${
							conditions[Math.floor(Math.random() * conditions.length)]
						}.`
					},
				},
			)

			const result = streamText({
				model: anthropic('claude-3-5-sonnet-20240620'),
				system: 'You are a terse assistant.',
				messages: processedMessages,
				tools,
				maxSteps: 10,
				maxTokens: 1000,
			})

			result.mergeIntoDataStream(dataStream)
		},
	})
}
