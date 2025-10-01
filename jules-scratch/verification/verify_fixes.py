import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            # Go to the local file
            await page.goto("file:///app/index.html")

            # Wait for the login page to be visible
            await expect(page.locator("#login-page")).to_be_visible(timeout=10000)

            # --- Admin Login ---
            await page.click("#admin-login-link")
            await expect(page.locator("#admin-login-modal")).to_be_visible()
            await page.fill("#admin-login-email", "test.user@email.com")
            await page.fill("#admin-login-password", "password")
            await page.click("#admin-login-form button[type='submit']")

            # --- Dashboard Verification ---
            await expect(page.locator("#main-page")).to_be_visible(timeout=10000)
            await expect(page.locator("#user-email")).to_have_text("test.user@email.com")

            # Wait for indicators to potentially load data
            await page.wait_for_timeout(2000)
            await page.screenshot(path="jules-scratch/verification/01_dashboard.png")

            # --- Cadastros - RH Verification ---
            await page.click("a.nav-link[data-target='cadastros-page']")
            await expect(page.locator("#cadastros-page")).to_be_visible()
            await page.click("#rh-card-link")
            await expect(page.locator("#rh-cadastro-section")).to_be_visible()
            await expect(page.locator("#funcionario-form")).to_be_visible()

            # Wait for form to be populated
            await page.wait_for_timeout(1000)
            await page.screenshot(path="jules-scratch/verification/02_rh_form.png")

            # --- Contas a Pagar Verification ---
            # Use the dropdown to navigate
            await page.click("#financeiro-nav-link-cadastros")
            await page.click("a.nav-link[data-target='contas-a-pagar-page']")

            await expect(page.locator("#contas-a-pagar-page")).to_be_visible(timeout=10000)
            # Wait for table to load
            await page.wait_for_timeout(2000)
            await page.screenshot(path="jules-scratch/verification/03_contas_a_pagar.png")

        except Exception as e:
            print(f"An error occurred: {e}")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())