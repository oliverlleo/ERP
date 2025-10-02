import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(20000)

        try:
            await page.goto("file:///app/index.html")

            # --- 1. Login as Admin to set up data ---
            await page.locator("#admin-login-link").click()
            await expect(page.locator("#admin-login-modal")).to_be_visible()
            await page.locator("#admin-login-email").fill("test.user@email.com")
            await page.locator("#admin-login-form button[type='submit']").click()
            await expect(page.locator("#main-page")).to_be_visible()
            print("Admin login successful.")

            # --- 2. Create prerequisite data ---
            await page.locator('#main-page header nav a[data-target="cadastros-page"]').click()
            await expect(page.locator("#cadastros-page")).to_be_visible()
            print("Navigated to Cadastros page.")

            # Create Fornecedor
            await page.locator("#comerciais-card-link").click()
            await expect(page.locator("#comerciais-cadastro-section")).to_be_visible()
            await page.locator(".tab-link-comercial[data-tab-comercial='fornecedores']").click()
            await page.locator("#fornecedor-razao-social").fill("Fornecedor de Teste")
            await page.locator("#fornecedor-form button[type='submit']").click()
            await expect(page.locator('td:has-text("Fornecedor de Teste")')).to_be_visible()
            print("Fornecedor created and verified in table.")

            # Create Plano de Contas
            await page.locator("#financeiros-card-link").click()
            await expect(page.locator("#financeiros-cadastro-section")).to_be_visible()
            await page.locator(".tab-link-financeiro[data-tab-financeiro='planos-de-contas']").click()
            await page.locator("#plano-conta-nome").fill("Aluguel")
            await page.locator("#plano-conta-form button[type='submit']").click()
            await expect(page.locator('td:has-text("Aluguel")')).to_be_visible()
            print("Plano de Contas created and verified in table.")

            # --- 3. Logout Admin ---
            await page.locator("#profile-button-cadastros").click()
            await page.locator("#logout-button-cadastros").click()
            await expect(page.locator("#login-page")).to_be_visible()
            print("Admin logged out successfully.")

            print("Data creation script completed successfully.")
            await page.screenshot(path="jules-scratch/verification/data_creation_success.png")

        except Exception as e:
            print(f"An error occurred during verification: {e}")
            await page.screenshot(path="jules-scratch/verification/error.png")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())