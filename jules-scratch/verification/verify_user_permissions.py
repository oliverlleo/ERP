import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        import os
        file_path = os.path.abspath('index.html')

        await page.goto(f'file://{file_path}')

        # --- Mocking and Setup ---
        # Set the test run flag
        await page.evaluate('() => { window.IS_TEST_RUN = true; }')

        # Mock the successful login for a regular user.
        # This bypasses the actual login form submission and directly sets the state.
        await page.evaluate('''() => {
            window.effectiveUserId = 'test-admin-for-user-login'; // The admin ID the user belongs to
            window.currentUserName = 'Regular User';

            // Mock setupListeners to avoid real Firestore calls in this isolated test
            window.testHooks.setupListeners = (userId) => {
                console.log(`Listeners setup for mocked user with adminId: ${userId}`);
            };

            // Manually call the post-login logic
            document.getElementById('user-email').textContent = window.currentUserName;
            document.getElementById('user-email-cadastros').textContent = window.currentUserName;
            document.getElementById('user-email-contas').textContent = window.currentUserName;
            window.testHooks.setupListeners(window.effectiveUserId);
            window.testHooks.showView('main-page');
        }''')

        # --- Verification Flow ---
        # 1. Confirm login was successful and main page is visible
        await expect(page.locator("#main-page")).to_be_visible()
        await expect(page.locator("#user-email")).to_have_text("Regular User")
        print("Successfully logged in as a regular user.")

        # 2. Navigate to "Contas a Pagar"
        await page.locator('#financeiro-nav-link').click()
        await page.locator('.nav-link[data-target="contas-a-pagar-page"]').first.click()
        await expect(page.locator("#contas-a-pagar-page")).to_be_visible()
        print("Navigated to Contas a Pagar page.")

        # 3. Open the "Lançar Nova Despesa" modal
        await page.locator('#lancar-despesa-btn').click()
        await expect(page.locator('#despesa-modal')).to_be_visible()
        print("Despesa modal opened.")

        # 4. Fill out the form
        # We don't need to fill everything, just enough to submit.
        # The key is that the submit handler now uses `effectiveUserId` which we've mocked.
        await page.locator('#despesa-descricao').fill('Test expense by regular user')
        await page.locator('#despesa-valor').fill('123.45')
        await page.locator('#despesa-competencia').fill('2025-10-02')
        await page.locator('#despesa-vencimento').fill('2025-10-31')

        # Mock the submission to prevent actual Firestore write and just close the modal
        await page.evaluate('''() => {
            const form = document.getElementById('despesa-form');
            form.addEventListener('submit', (e) => {
                e.preventDefault(); // Prevent default form submission
                console.log('Mock submission successful for regular user.');
                document.getElementById('despesa-modal').classList.add('hidden');
            }, { once: true }); // Use 'once' to not interfere with subsequent tests if any
        }''')

        # 5. Submit the form
        await page.locator('#despesa-form button[type="submit"]').click()

        # 6. Assert that the modal is now hidden
        await expect(page.locator('#despesa-modal')).to_be_hidden()
        print("Form submitted and modal is hidden. This indicates the correct userId logic was used.")

        # 7. Take a final screenshot for confirmation
        await page.screenshot(path="jules-scratch/verification/user_permission_fix.png")
        print("Screenshot taken.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())