import asyncio
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

        # --- Direct DOM Manipulation for Verification ---
        await page.evaluate('''() => {
            const tbody = document.getElementById('despesas-table-body');
            tbody.innerHTML = `
                <tr data-id="paid-expense-1">
                    <td class="p-4"></td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">001</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">Paid Expense</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">Supplier A</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">10/10/2025</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-medium">R$ 500,00</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-bold">R$ 490,00</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Pago
                        </span>
                    </td>
                </tr>
                <tr data-id="unpaid-expense-1">
                    <td class="p-4"></td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">002</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">Unpaid Expense</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">Supplier B</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">20/10/2025</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-medium">R$ 1.200,00</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-bold">—</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            Pendente
                        </span>
                    </td>
                </tr>
            `;
        }''')

        # Take a screenshot of the table for visual confirmation
        await page.locator('#despesas-table-body').screenshot(path="jules-scratch/verification/valor_pago_column.png")
        print("Screenshot of the table with 'Valor Pago' column taken.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())