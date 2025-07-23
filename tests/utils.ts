export async function waitFor(
	assertion: () => void,
	{
		timeout = 200,
		interval = 10,
	}: { timeout?: number; interval?: number } = {},
) {
	const startTime = Date.now()
	let lastError: Error | undefined

	while (Date.now() - startTime < timeout) {
		try {
			assertion()
			return // Assertion passed
		} catch (error) {
			lastError = error as Error
			await new Promise((resolve) => setTimeout(resolve, interval))
		}
	}
	if (lastError) {
		lastError.message = `TIMEOUT: ${lastError.message}`
		throw lastError
	}

	// Timeout reached, throw the last error
	throw new Error('Timeout waiting for assertion to pass')
}

export function createDeferred<T>() {
	const deferred: {
		resolve: (value: T) => void
		reject: (error: any) => void
		promise: Promise<T>
		value?: T
		error?: any
	} = {} as any
	const promise = new Promise((resolve, reject) => {
		deferred.resolve = (value: T) => {
			deferred.value = value
			resolve(value)
		}
		deferred.reject = (error: any) => {
			deferred.error = error
			reject(error)
		}
	})
	deferred.promise = promise as Promise<T>

	return deferred
}
