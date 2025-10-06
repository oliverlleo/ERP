import asyncio
from playwright.async_api import async_playwright, expect
import re

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # 1. Go to the application page via the local server
        await page.goto('http://localhost:8000/index.html')

        # Wait for the login page to be fully ready
        await expect(page.get_by_role("button", name="Entrar", exact=True)).to_be_visible(timeout=15000)
        print("Login page is visible and ready.")

        # 2. Perform Admin Login using the test user
        # NOTE: The test user is a special case handled in the JS to bypass Firebase auth
        await page.click('#admin-login-link')
        await expect(page.locator('#admin-login-modal')).to_be_visible()
        print("Admin login modal is visible.")

        await page.fill('#admin-login-email', 'test.user@email.com')
        await page.fill('#admin-login-password', 'anypassword') # Password doesn't matter
        await page.click('#admin-login-form button[type="submit"]')

        # Wait for main page to load
        await expect(page.locator('#main-page')).to_be_visible(timeout=10000)
        print("Login successful, main page is visible.")

        # 3. Navigate to Cash Flow
        await page.click('#financeiro-nav-link')
        await page.click('a.nav-link[data-target="fluxo-de-caixa-page"]')

        await expect(page.locator('#fluxo-de-caixa-page')).to_be_visible(timeout=10000)
        print("Navigated to Fluxo de Caixa page.")

        # 4. Click on the "Gráficos" tab
        await page.click('a.fluxo-tab-link[data-fluxo-tab="graficos"]')

        charts_tab_content = page.locator('#fluxo-graficos-tab')
        await expect(charts_tab_content).to_be_visible(timeout=10000)
        print("Switched to Gráficos tab.")

        # Wait for charts to render
        await page.wait_for_timeout(5000) # Increased wait time

        # 5. Take a screenshot
        await charts_tab_content.screenshot(path="jules-scratch/verification/charts_verification.png")
        print("Screenshot taken successfully.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())