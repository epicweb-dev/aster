import { type Route } from './+types/chat'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { z } from 'zod'
import { tools } from '#app/lib/tools'

const RequestSchema = z.object({
	id: z.string().optional(),
	messages: z.array(
		z.object({
			role: z.enum(['user', 'assistant']),
			content: z.string(),
			parts: z.array(z.any()).optional(),
		}),
	),
})

export async function action({ request, context }: Route.ActionArgs) {
	const rawBody = await request.json()
	const { messages } = RequestSchema.parse(rawBody)

	console.log('Received messages:', messages, tools)

	const anthropic = createAnthropic({
		apiKey: context.cloudflare.env.ANTHROPIC_API_KEY,
	})

	const result = streamText({
		model: anthropic('claude-3-5-sonnet-20240620'),
		system: 'You are a helpful assistant.',
		messages,
		tools,
		maxSteps: 10,
	})

	return result.toDataStreamResponse()
}
