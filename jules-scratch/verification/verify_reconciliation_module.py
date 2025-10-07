import asyncio
from playwright.async_api import async_playwright, expect
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path to index.html
        html_file_path = os.path.abspath('index.html')

        # Go to the local file
        await page.goto(f'file://{html_file_path}')

        # 1. Simulate Admin Login
        await page.evaluate('''() => {
            sessionStorage.setItem('userSession', JSON.stringify({
                isAdmin: true,
                effectiveUserId: 'test-user-123',
                currentUserName: 'test.user@email.com'
            }));
        }''')

        # Reload the page to apply the session state
        await page.reload()

        # Force the main page to be visible for the test, bypassing initialization issues
        await page.evaluate("showView('main-page')")

        # Wait for the main page to be visible after login
        await expect(page.locator("#main-page")).to_be_visible(timeout=10000)

        # 2. Navigate to the new page
        # Click the "Financeiro" dropdown in the main header
        await page.locator("#financeiro-nav-link").click()

        # Click the "Conciliação Bancária" link
        await page.get_by_role("link", name="Conciliação Bancária").first.click()

        # 3. Verify the new page is visible
        movimentacao_page = page.locator("#movimentacao-bancaria-page")
        await expect(movimentacao_page).to_be_visible(timeout=5000)

        # Check for the title of the new page
        await expect(movimentacao_page.get_by_role("heading", name="Movimentação Bancária / Conciliação")).to_be_visible()

        # Take a screenshot of the main reconciliation page
        await page.screenshot(path="jules-scratch/verification/reconciliation_page.png")
        print("Screenshot of the main page taken.")

        # 4. Open and verify the "Nova Entrada" modal
        await movimentacao_page.get_by_role("button", name="add Nova Entrada").click()

        modal = page.locator("#movimentacao-avulsa-modal")
        await expect(modal).to_be_visible(timeout=5000)

        # Check for the modal title
        await expect(modal.get_by_role("heading", name="Registrar Nova Entrada")).to_be_visible()

        # Take a screenshot of the modal
        await page.screenshot(path="jules-scratch/verification/new_entry_modal.png")
        print("Screenshot of the new entry modal taken.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())