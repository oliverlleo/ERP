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

        # 2. Wait for the Admin link and log in.
        admin_link = page.get_by_role("link", name="Acesso do Administrador")
        await expect(admin_link).to_be_visible(timeout=15000)
        await admin_link.click()
        await expect(page.locator("#admin-login-modal")).to_be_visible()
        await page.locator("#admin-login-email").fill("test.user@email.com")
        await page.locator("#admin-login-password").fill("password")
        await page.get_by_role("button", name="Entrar como Admin").click()

        # 3. Wait for the main page and navigate to Cash Flow.
        await expect(page.locator("#main-page")).to_be_visible(timeout=10000)
        await page.locator('#financeiro-nav-link').click()
        await page.locator('#financeiro-dropdown a[data-target="fluxo-de-caixa-page"]').click()

        # 4. Wait for the Cash Flow page to load.
        await expect(page.get_by_role("heading", name="Fluxo de Caixa")).to_be_visible(timeout=10000)

        # 5. Ensure both 'Realizado' and 'Projetado' are checked.
        await page.locator("#visao-realizado-checkbox").check()
        await page.locator("#visao-projetado-checkbox").check()

        # 6. Wait for the data to load by waiting for the "loading" message to disappear.
        loading_text = page.get_by_text("Carregando dados...")
        await expect(loading_text).to_be_hidden(timeout=20000) # Increased timeout for data fetching

        # Give an extra moment for charts to render.
        await page.wait_for_timeout(2000)

        # 7. Take a screenshot for visual verification.
        screenshot_path = 'jules-scratch/verification/final_cash_flow_view.png'
        await page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())