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

        # The page is now visible by default, so we can proceed directly.
        movimentacao_page = page.locator("#movimentacao-bancaria-page")
        await expect(movimentacao_page).to_be_visible(timeout=10000)

        # Check for the title of the new page
        await expect(movimentacao_page.get_by_role("heading", name="Movimentação Bancária / Conciliação")).to_be_visible()

        # Take a screenshot of the main reconciliation page
        await page.screenshot(path="jules-scratch/verification/reconciliation_page.png")
        print("Screenshot of the main page taken.")

        # Open and verify the "Nova Entrada" modal
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