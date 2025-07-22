import { useEffect, useRef } from 'react'

export function useAutoScroll<T extends HTMLElement = HTMLDivElement>() {
	const containerRef = useRef<T>(null)
	const scrollTargetRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// Track scroll position before mutations
		let wasNearBottom = false
		let isUserScrolling = false
		let scrollTimeout: number | null = null

		// Create mutation observer to watch for DOM changes
		const observer = new MutationObserver((mutations) => {
			// Check if any mutations added nodes (new messages) or changed text content
			const hasRelevantChanges = mutations.some(
				(mutation) =>
					(mutation.type === 'childList' && mutation.addedNodes.length > 0) ||
					mutation.type === 'characterData',
			)

			if (hasRelevantChanges) {
				// Use the stored scroll position from before the mutation
				if (wasNearBottom && !isUserScrolling) {
					// Small delay to ensure DOM is fully updated
					requestAnimationFrame(() => {
						scrollTargetRef.current?.scrollIntoView({ behavior: 'smooth' })
					})
				}
			}
		})

		// Track scroll position before mutations occur
		const trackScrollPosition = () => {
			wasNearBottom =
				container.scrollHeight - container.scrollTop - container.clientHeight <
				100
		}

		// Handle user scrolling
		const handleUserScroll = () => {
			isUserScrolling = true

			// Clear existing timeout
			if (scrollTimeout) {
				clearTimeout(scrollTimeout)
			}

			// Set a timeout to mark scrolling as finished after 150ms of no scroll events
			scrollTimeout = window.setTimeout(() => {
				isUserScrolling = false
			}, 150)

			trackScrollPosition()
		}

		// Listen for scroll events to update our tracking
		container.addEventListener('scroll', handleUserScroll, { passive: true })

		// Also check on resize events
		const resizeObserver = new ResizeObserver(trackScrollPosition)
		resizeObserver.observe(container)

		// Start observing
		observer.observe(container, {
			childList: true,
			characterData: true,
			subtree: true,
		})

		// Cleanup
		return () => {
			observer.disconnect()
			container.removeEventListener('scroll', handleUserScroll)
			resizeObserver.disconnect()
			if (scrollTimeout) {
				clearTimeout(scrollTimeout)
			}
		}
	}, [])

	return {
		containerRef,
		scrollTargetRef,
	}
}
