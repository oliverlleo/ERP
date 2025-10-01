import asyncio
import re
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(20000) # Slightly shorter timeout

        # --- 1. Login ---
        import os
        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)
        await page.locator("#login-email").fill("test.user@email.com")
        await page.locator("#login-password").fill("password")
        await page.locator("#login-form button[type='submit']").click()
        await expect(page.locator("#main-page h1")).to_have_text("Painel")
        print("Login successful.")

        # --- 2. Navigate to Contas a Pagar ---
        await page.locator('#main-page header').get_by_role('button', name='Financeiro').click()
        await page.locator('#financeiro-dropdown').get_by_role('link', name='Contas a Pagar').click()
        await expect(page.locator("#contas-a-pagar-page h1")).to_have_text("Módulo Financeiro")
        print("Navigation to 'Contas a Pagar' successful.")

        # --- 3. Create a new Expense with all fields ---
        await page.locator("#lancar-despesa-btn").click()
        await expect(page.locator("#despesa-modal")).to_be_visible()

        # Fill out the expense form
        expense_desc = "Despesa Completa Teste"
        expense_num = "NF-98765"
        await page.locator("#despesa-descricao").fill(expense_desc)
        await page.locator("#despesa-numero-documento").fill(expense_num)
        await page.locator("#despesa-valor").fill("999.99")
        await page.locator("#despesa-emissao").fill("2025-10-01")
        await page.locator("#despesa-vencimento").fill("2025-10-31")
        await page.locator("#despesa-competencia").fill("2025-10-01")

        # Select a category (assuming one exists)
        await page.locator("#despesa-categoria").select_option(index=1)

        # Submit
        await page.locator("#despesa-form button[type='submit']").click()
        await expect(page.locator("#despesa-modal")).to_be_hidden()
        print("Expense creation successful.")

        # --- 4. Verify the new expense in the table ---
        expense_row = page.locator(f'tr:has-text("{expense_desc}")')
        await expect(expense_row).to_be_visible()
        await expect(expense_row.locator(f'td:text("{expense_num}")')).to_be_visible()
        print("Expense visible in table with correct document number.")

        # --- 5. Test "Visualizar" button ---
        await expense_row.locator('.despesa-checkbox').check()
        await expect(page.locator("#visualizar-selecionada-btn")).to_be_enabled()
        await page.locator("#visualizar-selecionada-btn").click()

        # --- 6. Verify content of "Visualizar" modal ---
        await expect(page.locator("#visualizar-despesa-modal")).to_be_visible()
        await expect(page.locator("#view-despesa-descricao")).to_have_text(expense_desc)
        await expect(page.locator("#view-despesa-numero-documento")).to_have_text(expense_num)
        await expect(page.locator("#view-despesa-emissao")).to_have_text("01/10/2025")
        await expect(page.locator("#view-despesa-criado-por")).to_have_text("test.user@email.com")
        await expect(page.locator("#view-despesa-valor")).to_have_text("R$ 999,99")
        await expect(page.locator("#view-despesa-status")).to_have_text("Pendente")
        print("View modal opened with correct data.")

        # --- 7. Take Screenshot ---
        await page.screenshot(path="jules-scratch/verification/final_verification.png")
        print("Screenshot taken.")

        # --- 8. Close modal and test Edit button ---
        await page.locator("#ok-visualizar-modal-btn").click()
        await expect(page.locator("#visualizar-despesa-modal")).to_be_hidden()

        await expect(page.locator("#editar-selecionada-btn")).to_be_enabled()
        await page.locator("#editar-selecionada-btn").click()
        await expect(page.locator("#despesa-modal")).to_be_visible()
        await expect(page.locator("#despesa-numero-documento")).to_have_value(expense_num)
        await expect(page.locator("#despesa-emissao")).to_have_value("2025-10-01")
        print("Edit modal opened with correct pre-filled data.")
        await page.locator("#close-modal-btn").click()


        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())