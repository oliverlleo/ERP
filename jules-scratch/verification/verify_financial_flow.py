import asyncio
from playwright.async_api import async_playwright, expect
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path to the index.html file
        file_path = os.path.abspath('index.html')
        await page.goto(f'file://{file_path}')

        # --- 1. Login as Admin ---
        await page.get_by_role("link", name="Acesso do Administrador").click()
        await page.locator("#admin-login-email").fill("test.user@email.com")
        await page.locator("#admin-login-password").fill("password")
        await page.get_by_role("button", name="Entrar como Admin").click()
        await expect(page.locator("#main-page")).to_be_visible(timeout=10000)

        # --- 2. Setup Data: Create Supplier, Chart of Accounts, Bank Account ---
        await page.get_by_role("link", name="Cadastros").click()
        await expect(page.locator("#cadastros-page")).to_be_visible()

        # Create Supplier
        await page.locator("#comerciais-card-link").click()
        await expect(page.locator("#fornecedores-tab-comercial")).to_be_visible()
        await page.locator("#fornecedor-razao-social").fill("Imobiliária Central")
        await page.locator("#fornecedor-cnpj").fill("12.345.678/0001-99")
        await page.get_by_role("button", name="Salvar Fornecedor").click()
        await expect(page.locator("#fornecedor-form-feedback")).to_contain_text("salvo com sucesso", timeout=5000)

        # Create Chart of Accounts & Bank Account
        await page.locator("#financeiros-card-link").click()
        await expect(page.locator("#planos-de-contas-tab-financeiro")).to_be_visible()
        await page.locator("#plano-conta-nome").fill("Despesas Operacionais")
        await page.get_by_role("button", name="Salvar Categoria").click()
        await expect(page.locator("#plano-conta-form-feedback")).to_contain_text("salva com sucesso", timeout=5000)

        await page.get_by_role("link", name="Contas Bancárias", exact=True).click()
        await expect(page.locator("#contas-bancarias-tab-financeiro")).to_be_visible()
        await page.locator("#conta-bancaria-nome").fill("Conta Principal")
        await page.get_by_role("button", name="Salvar Conta").click()
        await expect(page.locator("#conta-bancaria-form-feedback")).to_contain_text("salva com sucesso", timeout=5000)

        # --- 3. Navigate to Accounts Payable and Create an Expense ---
        await page.locator("#financeiro-nav-link-cadastros").click()
        await page.get_by_role("link", name="Contas a Pagar").click()
        await expect(page.locator("#contas-a-pagar-page")).to_be_visible()

        await page.get_by_role("button", name="Novo").click()
        await expect(page.locator("#despesa-modal")).to_be_visible()

        await page.locator("#despesa-descricao").fill("Aluguel Escritório")
        await page.locator("#despesa-valor").fill("2500,00")
        await page.locator("#despesa-vencimento").fill("2025-10-10")
        await page.locator("#despesa-competencia").fill("2025-10-01")

        await page.locator("#favorecido-tipo").select_option("fornecedores")
        await page.wait_for_timeout(500) # Wait for dependent dropdown to populate
        await page.locator("#favorecido-nome").select_option(label="Imobiliária Central")
        await page.locator("#despesa-categoria").select_option(label="Despesas Operacionais")

        await page.get_by_role("button", name="Salvar Lançamento").click()
        await expect(page.get_by_role("cell", name="Aluguel Escritório")).to_be_visible(timeout=5000)

        # --- 4. Make a Partial Payment ---
        await page.get_by_role("cell", name="Aluguel Escritório").locator("..").get_by_role("checkbox").check()
        await page.get_by_role("button", name="Pagar").click()
        await expect(page.locator("#pagar-modal")).to_be_visible()

        await expect(page.locator("#saldo-devedor-display")).to_contain_text("R$ 2.500,00")

        await page.locator("#pagar-valor").fill("1000,00")
        await page.locator("#pagar-conta-saida").select_option(label="Conta Principal")

        await page.get_by_role("button", name="Confirmar Pagamento").click()

        # --- 5. Handle Partial Payment Confirmation ---
        await expect(page.locator("#confirmar-parcial-modal")).to_be_visible()
        await page.get_by_role("button", name="Confirmar e Salvar").click()

        await expect(page.locator("#confirmar-parcial-modal")).to_be_hidden(timeout=5000)
        await expect(page.get_by_role("cell", name="Pago Parcialmente")).to_be_visible(timeout=5000)

        # --- 6. View History and Take Screenshot ---
        # More specific selector to find the correct row after payment
        correct_row = page.get_by_role("row").filter(has=page.get_by_text("Aluguel Escritório")).filter(has=page.get_by_text("Pago Parcialmente"))
        await correct_row.get_by_role("checkbox").check()

        await page.get_by_role("button", name="Visualizar").click()
        await expect(page.locator("#visualizar-despesa-modal")).to_be_visible()

        # Check values in the view modal
        await expect(page.locator("#view-despesa-valor-original")).to_contain_text("R$ 2.500,00")
        await expect(page.locator("#view-despesa-total-pago")).to_contain_text("R$ 1.000,00")
        await expect(page.locator("#view-despesa-saldo-devedor")).to_contain_text("R$ 1.500,00")

        # Check history table
        await expect(page.get_by_role("cell", name="Pagamento", exact=True)).to_be_visible()

        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())