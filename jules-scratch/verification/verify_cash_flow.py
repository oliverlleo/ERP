import asyncio
from playwright.async_api import async_playwright, expect
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Get the absolute path to the index.html file
        file_path = os.path.abspath('index.html')

        # 1. Go to the local HTML file.
        await page.goto(f'file://{file_path}')

        # 2. Wait for the "Admin Access" link to be visible and then click it.
        # This is a more reliable way to ensure the login page is ready.
        admin_link = page.get_by_role("link", name="Acesso do Administrador")
        await expect(admin_link).to_be_visible(timeout=15000)
        await admin_link.click()

        # Wait for the admin modal to appear
        await expect(page.locator("#admin-login-modal")).to_be_visible()

        # 3. Fill in the login form and submit.
        await page.locator("#admin-login-email").fill("test.user@email.com")
        await page.locator("#admin-login-password").fill("password")
        await page.get_by_role("button", name="Entrar como Admin").click()

        # 4. Wait for the main page (dashboard) to be visible after login.
        await expect(page.locator("#main-page")).to_be_visible(timeout=10000)

        # 5. Navigate to the Cash Flow page via the dropdown menu.
        await page.locator('#financeiro-nav-link').click()
        await page.locator('#financeiro-dropdown a[data-target="fluxo-de-caixa-page"]').click()

        # 6. Wait for the Cash Flow page to load and verify a key element is present.
        await expect(page.get_by_role("heading", name="Fluxo de Caixa")).to_be_visible(timeout=10000)

        # Give a generous timeout for data and charts to render.
        await page.wait_for_timeout(5000)

        # 7. Take a screenshot for visual verification.
        screenshot_path = 'jules-scratch/verification/cash_flow_verification.png'
        await page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())