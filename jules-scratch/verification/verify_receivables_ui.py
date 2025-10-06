import asyncio
from playwright.async_api import async_playwright, expect, Page
import os
import re

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path of the index.html file
        file_path = os.path.abspath('index.html')
        await page.goto(f'file://{file_path}')

        print("Navigated to the page.")

        # 1. Login as Admin
        await page.click('#admin-login-link')
        await page.wait_for_selector('#admin-login-modal', state='visible')
        await page.fill('#admin-login-email', 'test.user@email.com')
        await page.fill('#admin-login-password', 'password123')
        await page.click('#admin-login-form button[type="submit"]')
        print("Logged in as admin.")

        # Wait for the main dashboard to load
        await expect(page.locator('#main-page')).to_be_visible(timeout=10000)
        print("Main page is visible.")

        # 2. Navigate to Contas a Receber
        # Use the dropdown in the header of the main page
        await page.click('#financeiro-nav-link')
        await page.wait_for_selector('#financeiro-dropdown', state='visible')
        await page.click('a.nav-link[data-target="contas-a-receber-page"]')

        # Wait for the Contas a Receber page to be visible
        await expect(page.locator('#contas-a-receber-page')).to_be_visible(timeout=10000)
        print("Navigated to Contas a Receber page.")

        # 3. Verify main table columns
        header_selector = '#receitas-table-body tr th'
        # Wait for at least one row to be rendered to ensure the table is there
        await page.wait_for_selector('#receitas-table-body tr', timeout=15000)

        print("Checking main table headers...")
        await expect(page.locator('th:has-text("Descontos")')).to_be_visible()
        await expect(page.locator('th:has-text("Juros")')).to_be_visible()
        print("Main table headers verified.")

        # 4. Open the details modal for the first receivable
        # Find the first row's checkbox and click it
        first_row_checkbox = page.locator('#receitas-table-body tr:first-child .receita-checkbox')
        await first_row_checkbox.wait_for(state='visible', timeout=10000)
        await first_row_checkbox.click()

        # Click the "Visualizar" button
        visualizar_btn = page.locator('#visualizar-receita-selecionada-btn')
        await expect(visualizar_btn).to_be_enabled()
        await visualizar_btn.click()
        print("Clicked 'Visualizar' button.")

        # Wait for the modal to appear
        modal_selector = '#visualizar-receita-modal'
        await page.wait_for_selector(modal_selector, state='visible')
        print("Details modal is visible.")

        # 5. Verify modal content
        # Check for summary fields
        await expect(page.locator(f'{modal_selector} p:has-text("Descontos Concedidos")')).to_be_visible()
        await expect(page.locator(f'{modal_selector} #view-receita-descontos')).to_be_visible()
        await expect(page.locator(f'{modal_selector} p:has-text("Juros Recebidos")')).to_be_visible()
        await expect(page.locator(f'{modal_selector} #view-receita-juros')).to_be_visible()
        print("Modal summary fields verified.")

        # Check for history table headers
        await expect(page.locator(f'{modal_selector} th:has-text("Juros")')).to_be_visible()
        await expect(page.locator(f'{modal_selector} th:has-text("Descontos")')).to_be_visible()
        print("Modal history table headers verified.")

        # 6. Take a screenshot
        screenshot_path = 'jules-scratch/verification/receivables_modal_verification.png'
        await page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())