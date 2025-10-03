import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # 1. Navigate to the local file
        import os
        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)

        # 2. Simulate Admin Login
        await page.click("#admin-login-link")
        await page.wait_for_selector("#admin-login-modal", state="visible")
        await page.fill("#admin-login-email", "test.user@email.com")
        await page.fill("#admin-login-password", "password")
        await page.click("#admin-login-form button[type='submit']")

        # Wait for main page to be visible
        await expect(page.locator("#main-page")).to_be_visible()

        # 3. Navigate to Contas a Receber
        await page.click("#financeiro-nav-link") # Correct ID for the main page header
        await page.click("a[data-target='contas-a-receber-page']")

        # Wait for the contas a receber page to load
        await expect(page.locator("#contas-a-receber-page")).to_be_visible()
        await expect(page.locator("h2:has-text('Contas a Receber')")).to_be_visible()

        # 4. Screenshot 1: Initial page
        await page.screenshot(path="jules-scratch/verification/01_contas_a_receber_page.png")

        # 5. Open Modal
        await page.click("#lancar-receita-btn")
        await expect(page.locator("#receita-modal")).to_be_visible()
        await expect(page.locator("h3:has-text('Lançar Nova Receita')")).to_be_visible()

        # 6. Screenshot 2: New Receivable Modal
        await page.screenshot(path="jules-scratch/verification/02_nova_receita_modal.png")

        # 7. Verify Installment Fields
        await page.select_option("#receita-forma-pagamento", "parcelado")
        await expect(page.locator("#receita-parcelado-fields")).to_be_visible()
        await page.screenshot(path="jules-scratch/verification/03_parcelado_fields.png")

        # 8. Verify Recurring Fields
        await page.select_option("#receita-forma-pagamento", "recorrente")
        await expect(page.locator("#receita-recorrente-fields")).to_be_visible()
        await page.screenshot(path="jules-scratch/verification/04_recorrente_fields.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())