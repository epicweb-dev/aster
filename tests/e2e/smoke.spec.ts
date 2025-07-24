import { test, expect } from '@playwright/test'

test('chat page loads', async ({ page }) => {
	await page.goto('/chat')

	await expect(page).toHaveTitle(/Aster Chat/)
})
