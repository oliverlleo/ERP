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

        # 1. Login as Admin
        await page.click('#admin-login-link')
        await expect(page.locator('#admin-login-modal')).to_be_visible()
        await page.fill('#admin-login-email', 'test.user@email.com')
        await page.fill('#admin-login-password', 'password')
        await page.click('#admin-login-form button[type="submit"]')
        await expect(page.locator('#main-page')).to_be_visible()

        # 2. Navigate to Cadastros -> Financeiros
        await page.click('a.nav-link[data-target="cadastros-page"]')
        await expect(page.locator('#cadastros-page')).to_be_visible()
        await page.click('#financeiros-card-link')
        await expect(page.locator('#financeiros-cadastro-section')).to_be_visible()

        # Ensure the correct tab is selected
        await page.click('.tab-link-financeiro[data-tab-financeiro="planos-de-contas"]')
        await expect(page.locator('#planos-de-contas-tab-financeiro')).not_to_have_class('hidden')

        # 3. Create a root account
        await page.click('#add-root-account-btn')
        await expect(page.locator('#plano-conta-modal')).to_be_visible()
        await page.fill('#plano-conta-nome-new', 'Receitas')
        await page.select_option('#plano-conta-tipo', 'receita')
        await page.click('input[name="aceitaLancamento"][value="false"]') # Sintética
        await page.click('#plano-conta-form-new button[type="submit"]')
        await expect(page.locator('#plano-conta-modal')).to_be_hidden() # Wait for modal to close
        await expect(page.locator('#plano-de-contas-tree')).to_contain_text('1')
        await expect(page.locator('#plano-de-contas-tree')).to_contain_text('Receitas')

        # 4. Create a sub-account
        await page.click('.add-sub-account-btn')
        await expect(page.locator('#plano-conta-modal')).to_be_visible()
        await page.fill('#plano-conta-nome-new', 'Receitas Operacionais')
        await page.click('input[name="aceitaLancamento"][value="false"]') # Sintética
        await page.click('#plano-conta-form-new button[type="submit"]')
        await expect(page.locator('#plano-conta-modal')).to_be_hidden() # Wait for modal to close
        await expect(page.locator('#plano-de-contas-tree')).to_contain_text('1.1')
        await expect(page.locator('#plano-de-contas-tree')).to_contain_text('Receitas Operacionais')

        # 5. Create an analytical account
        await page.locator('div.pl-6 .add-sub-account-btn').click()
        await expect(page.locator('#plano-conta-modal')).to_be_visible()
        await page.fill('#plano-conta-nome-new', 'Venda de Projetos')
        await page.click('input[name="aceitaLancamento"][value="true"]') # Analítica
        await page.check('#aplicavel-recebimentos')
        await page.click('#plano-conta-form-new button[type="submit"]')
        await expect(page.locator('#plano-conta-modal')).to_be_hidden() # Wait for modal to close
        await expect(page.locator('#plano-de-contas-tree')).to_contain_text('1.1.1')
        await expect(page.locator('#plano-de-contas-tree')).to_contain_text('Venda de Projetos')

        # 6. Navigate to Contas a Receber
        await page.click('#financeiro-nav-link-cadastros')
        await page.click('a.nav-link[data-target="contas-a-receber-page"]')
        await expect(page.locator('#contas-a-receber-page')).to_be_visible()

        # 7. Verify the new account in the dropdown
        await page.click('#lancar-receita-btn')
        await expect(page.locator('#receita-modal')).to_be_visible()

        # Click the dropdown to show options
        await page.click('#receita-categoria')

        # 8. Take a screenshot
        await page.screenshot(path='jules-scratch/verification/verification.png')

        # Assert that the new account is in the dropdown
        option_text = '1.1.1 - Venda de Projetos'
        # Check if an option with the specific text exists. Playwright handles the &nbsp; correctly.
        await expect(page.locator(f'#receita-categoria option:has-text("{option_text}")')).to_be_visible()

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())