from playwright.sync_api import sync_playwright, expect

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # 1. Navigate to the application
        # Using file path for local execution
        page.goto("file:///app/index.html")

        # 2. Login as Admin
        page.click("#admin-login-link")
        expect(page.locator("#admin-login-modal")).to_be_visible()
        page.fill("#admin-login-email", "test.user@email.com")
        page.fill("#admin-login-password", "password") # Password doesn't matter for test user
        page.click("#admin-login-form button[type='submit']")

        # Wait for main page to be visible
        expect(page.locator("#main-page")).to_be_visible(timeout=10000)

        # Manually trigger data listeners since we're using a mock login
        page.evaluate("() => window.testHooks.setupListeners('test-user-123')")
        print("Login successful and data listeners triggered.")

        # 3. Navigate to Contas a Pagar
        page.click("#financeiro-nav-link")
        page.click("a[data-target='contas-a-pagar-page']")
        expect(page.locator("#contas-a-pagar-page")).to_be_visible()
        print("Navigated to Contas a Pagar.")

        # 4. Create a new expense to test
        page.click("#lancar-despesa-btn")
        expect(page.locator("#despesa-modal")).to_be_visible()

        # Fill out the form
        page.fill("#despesa-descricao", "Teste de Desconto")
        page.select_option("#favorecido-tipo", "fornecedores")

        # Wait for the favorecido-nome dropdown to be populated by checking the option count
        page.wait_for_function("() => document.querySelector('#favorecido-nome').options.length > 1", timeout=10000)
        page.select_option("#favorecido-nome", index=1) # Select the first available provider

        # Wait for the despesa-categoria dropdown to be populated
        page.wait_for_function("() => document.querySelector('#despesa-categoria').options.length > 1", timeout=10000)
        page.select_option("#despesa-categoria", index=1) # Select the first available category
        page.fill("#despesa-valor", "500,00")
        page.fill("#despesa-vencimento", "2025-10-15")
        page.fill("#despesa-competencia", "2025-10-01")

        page.click("#despesa-form button[type='submit']")
        print("Expense created.")

        # Wait for the modal to disappear
        expect(page.locator("#despesa-modal")).to_be_hidden()
        page.wait_for_timeout(1000) # Wait for table to update

        # 5. Find the new expense and pay it with a discount
        expense_row = page.locator("tr:has-text('Teste de Desconto')")
        expect(expense_row).to_be_visible()
        expense_row.locator(".despesa-checkbox").check()

        page.click("#pagar-selecionadas-btn")
        expect(page.locator("#pagar-modal")).to_be_visible()
        print("Payment modal opened.")

        # Fill payment form: Pay 400 with a 100 discount on a 500 expense
        page.fill("#pagar-valor", "400,00")
        page.fill("#pagar-descontos", "100,00")
        page.fill("#pagar-data", "2025-10-02")
        page.select_option("#pagar-conta-saida", index=1) # Select first account

        page.click("#pagar-form button[type='submit']")

        # 6. Verify it was paid and the partial payment modal did NOT appear
        expect(page.locator("#confirmar-parcial-modal")).to_be_hidden()
        expect(page.locator("#pagar-modal")).to_be_hidden()
        print("Payment submitted, partial payment modal did not appear.")

        # Wait for the table to update and show "Pago" status
        page.wait_for_timeout(1000)
        expect(expense_row.locator("span:has-text('Pago')")).to_be_visible()
        print("Expense marked as 'Pago'.")

        # 7. Take screenshot of the table with the new discount column
        page.screenshot(path="jules-scratch/verification/table_with_discounts.png")
        print("Screenshot of the table taken.")

        # 8. Open the details modal and verify the discount is shown
        expense_row.locator(".despesa-checkbox").check() # Re-select if needed
        page.click("#visualizar-selecionada-btn")
        expect(page.locator("#visualizar-despesa-modal")).to_be_visible()

        # Check for the discount value in the summary
        expect(page.locator("#view-despesa-descontos")).to_have_text("R$ 100,00")
        print("Discount visible in details modal.")

        # 9. Take screenshot of the details modal
        page.screenshot(path="jules-scratch/verification/modal_with_discounts.png")
        print("Screenshot of the modal taken.")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")
    finally:
        browser.close()

with sync_playwright() as p:
    run_verification(p)