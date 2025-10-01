import asyncio
import re
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Set a generous timeout for the whole test
        page.set_default_timeout(30000)

        # --- 1. Login ---
        import os
        file_path = "file://" + os.path.abspath("index.html")
        await page.goto(file_path)
        await page.locator("#login-email").fill("test.user@email.com")
        await page.locator("#login-password").fill("password")
        await page.locator("#login-form button[type='submit']").click()
        await expect(page.locator("#main-page h1")).to_have_text("Painel")
        print("Login successful.")

        # --- 2. Create a new Supplier ---
        # Use a more specific locator within the main page's header
        await page.locator('#main-page header').get_by_role('link', name='Cadastros').click()
        await expect(page.locator("#cadastros-page h1")).to_have_text("Módulo de Cadastros")

        await page.locator("#comerciais-card-link").click()
        await expect(page.locator("#comerciais-cadastro-section")).to_be_visible()

        # Ensure 'Fornecedores' tab is active
        await page.locator('.tab-link-comercial[data-tab-comercial="fornecedores"]').click()
        await expect(page.locator("#fornecedores-tab-comercial")).to_be_visible()

        # Fill out the form
        supplier_name = "Fornecedor de Teste S.A."
        supplier_cnpj = "12.345.678/0001-99"

        await page.locator("#fornecedor-tipo-pessoa").select_option("juridica")
        await page.locator("#fornecedor-razao-social").fill(supplier_name)
        await page.locator("#fornecedor-cnpj").fill(supplier_cnpj)

        # Click on the 'Contato' tab to make its fields visible
        await page.locator('.fornecedor-tab-link[data-fornecedor-tab="fornecedor-contato"]').click()
        await page.locator("#fornecedor-contato-principal").fill("João da Silva")

        # Submit the form
        await page.locator("#fornecedor-form button[type='submit']").click()

        # Verify the new supplier appears in the table
        await expect(page.locator(f'//td[text()="{supplier_name}"]')).to_be_visible()
        await expect(page.locator(f'//td[text()="{supplier_cnpj}"]')).to_be_visible()
        print("Supplier creation successful.")

        # --- 3. Create a new Expense using the Supplier ---
        # Click the 'Financeiro' dropdown, then the 'Contas a Pagar' link
        await page.locator('#cadastros-page header').get_by_role('button', name='Financeiro').click()
        await page.locator('#financeiro-dropdown-cadastros').get_by_role('link', name='Contas a Pagar').click()
        await expect(page.locator("#contas-a-pagar-page h1")).to_have_text("Módulo Financeiro")

        await page.locator("#lancar-despesa-btn").click()
        await expect(page.locator("#despesa-modal")).to_be_visible()

        # Fill out the expense form
        await page.locator("#despesa-descricao").fill("Serviço de Teste para Screenshot")
        await page.locator("#despesa-valor").fill("123.45")
        await page.locator("#despesa-vencimento").fill("2025-10-15")
        await page.locator("#despesa-competencia").fill("2025-10-01")

        # Select the newly created supplier
        await page.locator("#favorecido-tipo").select_option("fornecedores")
        # Wait for options to populate
        await expect(page.locator(f'#favorecido-nome option:text("{supplier_name}")')).to_be_visible()
        await page.locator("#favorecido-nome").select_option(label=supplier_name)

        # Submit
        await page.locator("#despesa-form button[type='submit']").click()
        await expect(page.locator("#despesa-modal")).to_be_hidden()
        print("Expense creation successful.")

        # --- 4. Verify "Contas a Pagar" actions ---
        # Find the new expense in the table and select it
        expense_row = page.locator('tr:has-text("Serviço de Teste para Screenshot")')
        await expect(expense_row).to_be_visible()
        await expense_row.locator('.despesa-checkbox').check()

        # Verify buttons are enabled
        await expect(page.locator("#pagar-selecionadas-btn")).to_be_enabled()
        await expect(page.locator("#editar-selecionada-btn")).to_be_enabled()
        await expect(page.locator("#excluir-selecionadas-btn")).to_be_enabled()
        print("Action buttons correctly enabled.")

        # --- 5. Take Screenshot ---
        await page.screenshot(path="jules-scratch/verification/finance_verification.png")
        print("Screenshot taken.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())