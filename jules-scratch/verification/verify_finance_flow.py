import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # --- DIAGNOSTIC: Capture all console messages ---
        # Corrected: msg.text is a property, not a function.
        page.on('console', lambda msg: print(f"BROWSER LOG: {msg.text}"))

        try:
            # 1. Navigate to the app
            await page.goto("file:///app/index.html", wait_until="domcontentloaded")

            # 2. Login as a regular user
            await page.select_option("#login-empresa", label="azo", timeout=15000)
            await page.fill("#login-usuario", "ana.silva")
            await page.fill("#login-password", "senha123")
            await page.click("button[type='submit']")

            # Wait for login to process
            await page.wait_for_timeout(1500)

            # Force the main page visible to continue diagnostics
            await page.evaluate("() => { \
                document.getElementById('login-page').classList.remove('visible'); \
                document.getElementById('main-page').classList.add('visible'); \
            }")
            await expect(page.locator("#main-page")).to_be_visible(timeout=5000)
            print("Login successful (main page visibility was FORCED for diagnostics).")

            # 3. Navigate to "Contas a Pagar"
            await page.click("#financeiro-nav-link")
            await expect(page.locator("#financeiro-dropdown")).to_be_visible()
            await page.click("a[data-target='contas-a-pagar-page']")

            await expect(page.locator("#contas-a-pagar-page")).to_be_visible(timeout=10000)
            print("Navigation to 'Contas a Pagar' successful.")

            # 4. Create a new expense
            await page.click("#lancar-despesa-btn")
            await expect(page.locator("#despesa-modal")).to_be_visible()

            await page.fill("#despesa-descricao", "Teste de Juros e Desconto")
            await page.select_option("#favorecido-tipo", label="Fornecedor")

            # This is the point of failure. The options are not loading.
            await expect(page.locator("#favorecido-nome option", has_text="TechSolutions Ltda")).to_be_visible(timeout=10000)
            await page.select_option("#favorecido-nome", label="TechSolutions Ltda")

            await page.select_option("#despesa-categoria", label="Despesas Administrativas")
            await page.fill("#despesa-valor", "1000")
            await page.fill("#despesa-vencimento", "2025-10-15")
            await page.fill("#despesa-competencia", "2025-10-01")

            await page.click("#despesa-form-submit-btn")
            await expect(page.locator("#despesa-modal")).to_be_hidden()
            print("Expense creation successful.")

        except Exception as e:
            print(f"An error occurred: {e}")
            await page.screenshot(path="jules-scratch/verification/error.png")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())