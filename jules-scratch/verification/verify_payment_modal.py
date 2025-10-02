import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            # Navigate to the local file
            await page.goto("file:///app/index.html")

            # --- Login as a regular user ---
            await page.locator("#login-empresa").select_option(label="Empresa Teste")
            await page.locator("#login-usuario").fill("testuser")
            await page.locator("#login-password").fill("password")
            await page.locator('button:has-text("Entrar")').click()

            # --- Wait for the main page to be visible ---
            await expect(page.locator("#main-page")).to_be_visible(timeout=10000)

            # --- Navigate to Contas a Pagar ---
            # Click the financeiro dropdown
            await page.locator("#financeiro-nav-link").click()
            # Click the "Contas a Pagar" link
            await page.locator('a.nav-link[data-target="contas-a-pagar-page"]').click()

            # --- Wait for the Contas a Pagar page to be visible ---
            await expect(page.locator("#contas-a-pagar-page")).to_be_visible(timeout=10000)

            # --- Create a new expense to ensure one exists ---
            await page.locator("#lancar-despesa-btn").click()
            await expect(page.locator("#despesa-modal")).to_be_visible()
            await page.locator("#despesa-descricao").fill("Aluguel do Escritório")
            await page.locator("#favorecido-tipo").select_option("fornecedores")
            await page.locator("#favorecido-nome").select_option(label="Fornecedor Padrão")
            await page.locator("#despesa-categoria").select_option(label="Despesas Administrativas")
            await page.locator("#despesa-valor").fill("1500")
            await page.locator("#despesa-vencimento").fill("2025-10-10")
            await page.locator("#despesa-form-submit-btn").click()
            await expect(page.locator("#despesa-modal")).to_be_hidden()

            # --- Open the payment modal for the new expense ---
            # Wait for the table to update
            await page.wait_for_timeout(1000)

            # Select the newly created expense
            await page.locator('td:has-text("Aluguel do Escritório")').first.get_by_role("checkbox").check()

            # Click the "Pagar" button
            pagar_btn = page.locator("#pagar-selecionadas-btn")
            await expect(pagar_btn).to_be_enabled()
            await pagar_btn.click()

            # --- Verify the payment modal ---
            await expect(page.locator("#pagar-modal")).to_be_visible()

            # Check for new fields
            await expect(page.locator("#pagar-descontos")).to_be_visible()
            await expect(page.locator("#pagar-juros-multa")).to_be_visible()
            await expect(page.locator("#pagar-valor-final")).to_be_visible()

            # --- Test the automatic calculation ---
            await page.locator("#pagar-valor").fill("1500")
            await page.locator("#pagar-juros-multa").fill("50")
            await page.locator("#pagar-descontos").fill("100")

            # Verify the final calculated value
            await expect(page.locator("#pagar-valor-final")).to_have_value("1450.00")

            # --- Take a screenshot ---
            await page.screenshot(path="jules-scratch/verification/payment_modal_verification.png")
            print("Screenshot taken successfully.")

        except Exception as e:
            print(f"An error occurred: {e}")
            await page.screenshot(path="jules-scratch/verification/error.png")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())