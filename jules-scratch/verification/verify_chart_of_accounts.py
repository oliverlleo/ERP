import asyncio
from playwright.async_api import async_playwright, expect
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path of the HTML file
        file_path = os.path.abspath('index.html')

        # 1. Go to the page
        await page.goto(f'file://{file_path}')
        print("Page loaded.")

        # 2. Force the login page and modal to be visible, then log in
        await page.evaluate("() => { document.getElementById('login-page').classList.add('visible'); }")
        await page.evaluate("() => { document.getElementById('admin-login-modal').classList.remove('hidden'); }")
        await expect(page.locator('#admin-login-modal')).to_be_visible()

        await page.locator('#admin-login-email').fill('test.user@email.com')
        await page.locator('#admin-login-password').fill('password')
        await page.locator('#admin-login-form button[type="submit"]').click()
        print("Admin login submitted.")

        # 3. Manually hide login page and show main dashboard
        await page.evaluate("() => { document.getElementById('login-page').classList.remove('visible'); }")
        await page.evaluate("() => { document.getElementById('main-page').classList.add('visible'); }")
        await expect(page.locator('#main-page')).to_be_visible(timeout=10000)
        print("Main dashboard visible.")

        # 4. Navigate to Cadastros by directly manipulating the view
        await page.evaluate("() => { document.getElementById('main-page').classList.remove('visible'); document.getElementById('cadastros-page').classList.add('visible'); }")
        await expect(page.locator('#cadastros-page')).to_be_visible()
        print("Navigated to Cadastros page.")

        # 5. Open Financeiros e Contábeis section
        await page.locator('#financeiros-card-link').click()
        await expect(page.locator('#financeiros-cadastro-section')).to_be_visible()
        print("Financeiros section visible.")

        # 6. Verify and screenshot the Chart of Accounts Tree
        await expect(page.locator('#plano-contas-tree')).to_be_visible()
        await page.wait_for_timeout(1000) # Ensure rendering is complete
        await page.screenshot(path='jules-scratch/verification/01_chart_of_accounts_tree.png')
        print("Screenshot 1: Chart of Accounts tree captured.")

        # 7. Navigate to Contas a Pagar
        await page.evaluate("() => { document.getElementById('cadastros-page').classList.remove('visible'); document.getElementById('contas-a-pagar-page').classList.add('visible'); }")
        await expect(page.locator('#contas-a-pagar-page')).to_be_visible()
        print("Navigated to Contas a Pagar page.")

        # 8. Open the New Expense modal and take a screenshot
        await page.locator('#lancar-despesa-btn').click()
        await expect(page.locator('#despesa-modal')).to_be_visible()
        await page.locator('#despesa-categoria').click() # Click to open dropdown
        await page.wait_for_timeout(500) # Wait for dropdown animation
        await page.screenshot(path='jules-scratch/verification/02_expense_modal_dropdown.png')
        print("Screenshot 2: Expense modal with dropdown captured.")
        await page.locator('#close-modal-btn').click() # Close the modal

        # 9. Navigate to Contas a Receber
        await page.evaluate("() => { document.getElementById('contas-a-pagar-page').classList.remove('visible'); document.getElementById('contas-a-receber-page').classList.add('visible'); }")
        await expect(page.locator('#contas-a-receber-page')).to_be_visible()
        print("Navigated to Contas a Receber page.")

        # 10. Open the New Receivable modal and take a screenshot
        await page.locator('#lancar-receita-btn').click()
        await expect(page.locator('#receita-modal')).to_be_visible()
        await page.locator('#receita-categoria').click() # Click to open dropdown
        await page.wait_for_timeout(500) # Wait for dropdown animation
        await page.screenshot(path='jules-scratch/verification/03_receivable_modal_dropdown.png')
        print("Screenshot 3: Receivable modal with dropdown captured.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())