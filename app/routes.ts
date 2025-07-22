import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
	index('routes/home.tsx'),
	route('chat', 'routes/chat.tsx'),
	route('chat-new', 'routes/chat-new.tsx'),
	route('chat-new2', 'routes/chat-new2.tsx'),
	route('search', 'routes/search.tsx'),
] satisfies RouteConfig
