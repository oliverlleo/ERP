import asyncio
from playwright.async_api import async_playwright, expect
import pathlib

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # 1. Navigate to the local index.html file
        file_path = pathlib.Path(__file__).parent.parent.parent.resolve() / "index.html"
        await page.goto(f"file://{file_path}")

        # 2. Log in as Admin
        await page.click("#admin-login-link")
        await expect(page.locator("#admin-login-modal")).to_be_visible()
        await page.fill("#admin-login-email", "test.user@email.com")
        # The password field is not actually used in the test environment login
        await page.click("#admin-login-form button[type='submit']")
        await expect(page.locator("#main-page")).to_be_visible()

        # 3. Create prerequisite data
        # Navigate to Cadastros
        await page.click("a[data-target='cadastros-page']")
        await expect(page.locator("#cadastros-page")).to_be_visible()

        # Create a Client
        await page.click("#comerciais-card-link")
        await expect(page.locator("#comerciais-cadastro-section")).to_be_visible()
        await page.click("a[data-tab-comercial='clientes']")
        await expect(page.locator("#clientes-tab-comercial")).not_to_have_class("hidden")
        await page.fill("#cliente-nome-completo", "Cliente Exemplo")
        await page.click("#cliente-form button[type='submit']")
        await expect(page.locator("#clientes-table-body")).to_contain_text("Cliente Exemplo", timeout=10000)

        # Create a Category
        await page.click("#financeiros-card-link")
        await expect(page.locator("#financeiros-cadastro-section")).to_be_visible()
        await page.click("a[data-tab-financeiro='planos-de-contas']")
        await expect(page.locator("#planos-de-contas-tab-financeiro")).not_to_have_class("hidden")
        await page.fill("#plano-conta-nome", "Receita de Projetos")
        await page.click("#plano-conta-form button[type='submit']")
        await expect(page.locator("#planos-contas-table-body")).to_contain_text("Receita de Projetos", timeout=10000)

        # 4. Navigate to Contas a Receber
        await page.click("a[data-target='contas-a-receber-page']")
        await expect(page.locator("#contas-a-receber-page")).to_be_visible()
        await page.wait_for_timeout(1000)

        # 5. Create a new receivable
        await page.click("#lancar-receita-btn")
        await expect(page.locator("#receita-modal")).to_be_visible(timeout=10000)

        await page.fill("#receita-descricao", "Serviço de Consultoria")

        # Select client and category
        await page.select_option("#receita-cliente", label="Cliente Exemplo")
        await page.select_option("#receita-categoria", label="Receita de Projetos")

        await page.fill("#receita-valor", "1500,00")
        await page.fill("#receita-emissao", "2025-10-03")
        await page.fill("#receita-competencia", "2025-10-03")
        await page.fill("#receita-vencimento", "2025-10-31")

        await page.click("#receita-form button[type='submit']")

        # 6. Verify the receivable appears in the table
        await expect(page.locator("#receitas-table-body tr")).to_have_count(1, timeout=10000)

        receivable_row = page.locator("#receitas-table-body tr:first-child")
        await expect(receivable_row.locator("td:nth-child(3)")).to_have_text("Serviço de Consultoria")
        await expect(receivable_row.locator("td:nth-child(4)")).to_have_text("Cliente Exemplo")
        await expect(receivable_row.locator("td:nth-child(6)")).to_have_text("R$ 1.500,00")
        await expect(receivable_row.locator("td:nth-child(9) span")).to_have_text("Pendente")

        # 7. Take a screenshot
        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

asyncio.run(main())