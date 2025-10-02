import asyncio
import re
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        import os
        file_path = os.path.abspath('index.html')

        await page.goto(f'file://{file_path}')

        await page.evaluate('() => { window.IS_TEST_RUN = true; }')

        # --- Login and Navigate ---
        await page.locator("#admin-login-link").click()
        await page.locator("#admin-login-email").fill("test.user@email.com")
        await page.locator("#admin-login-password").fill("password")
        await page.locator("#admin-login-form button[type='submit']").click()

        await expect(page.locator("#main-page")).to_be_visible()

        await page.locator('#financeiro-nav-link').click()
        await page.locator('.nav-link[data-target="contas-a-pagar-page"]').first.click()
        await expect(page.locator("#contas-a-pagar-page")).to_be_visible()

        # --- Verification ---
        # Mock data to render in the table
        await page.evaluate('''() => {
            const mockDespesas = [
                {
                    id: 'paid-expense-1',
                    data: () => ({
                        numeroDocumento: '001',
                        descricao: 'Paid Expense',
                        favorecidoNome: 'Supplier A',
                        vencimento: '2025-10-10',
                        valor: 500,
                        valorPago: 490, // Paid with a discount
                        pago: true,
                    })
                },
                {
                    id: 'unpaid-expense-1',
                    data: () => ({
                        numeroDocumento: '002',
                        descricao: 'Unpaid Expense',
                        favorecidoNome: 'Supplier B',
                        vencimento: '2025-10-20',
                        valor: 1200,
                        valorPago: null,
                        pago: false,
                    })
                }
            ];

            // Overwrite the global variable
            window.allDespesas = mockDespesas;
        }''')

        # Check the "Include Paid" checkbox to ensure our paid expense is visible
        await page.locator('#include-paid-checkbox').check()

        # Now, re-render the table with the correct filter state
        await page.evaluate('() => { window.testHooks.applyFiltersAndRender(); }')

        # Assertions
        table_body = page.locator('#despesas-table-body')

        # Check paid row
        paid_row = table_body.locator('tr[data-id="paid-expense-1"]')
        await expect(paid_row.locator('td').nth(6)).to_have_text(re.compile(r'R\$\s*490,00'))

        # Check unpaid row
        unpaid_row = table_body.locator('tr[data-id="unpaid-expense-1"]')
        await expect(unpaid_row.locator('td').nth(6)).to_have_text('—')

        # Take a screenshot of the table for visual confirmation
        await page.locator('#despesas-table-body').screenshot(path="jules-scratch/verification/valor_pago_column.png")
        print("Screenshot of the table with 'Valor Pago' column taken.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())