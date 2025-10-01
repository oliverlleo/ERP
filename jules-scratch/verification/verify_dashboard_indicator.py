from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(no_viewport=True)
    page = context.new_page()

    # Capture console logs to help with debugging
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    # Automatically accept dialogs (like alerts)
    page.on("dialog", lambda dialog: dialog.accept())

    try:
        page.goto("http://localhost:8000")

        # 1. Log in as the test user
        page.fill("#login-email", "test.user@email.com")
        page.fill("#login-password", "password123")
        page.click("button[type='submit']")
        expect(page.locator("#main-page")).to_be_visible(timeout=10000)
        print("Login successful.")

        # 2. Capture the initial value of the pending expenses indicator
        initial_expenses_text = page.locator("#expenses-value").inner_text()
        print(f"Initial 'Despesas Pendentes': {initial_expenses_text}")

        # 3. Navigate to create prerequisites for the expense
        page.click("a.nav-link[data-target='cadastros-page']")
        expect(page.locator("#cadastros-page")).to_be_visible()

        # Create Fornecedor if it doesn't exist
        page.click("#comerciais-card-link")
        if page.locator("#fornecedores-table-body", has_text="Dashboard-Verify-Fornecedor").count() == 0:
            page.fill("#fornecedor-nome", "Dashboard-Verify-Fornecedor")
            page.click("#fornecedor-form button[type='submit']")
            expect(page.locator("#fornecedores-table-body")).to_contain_text("Dashboard-Verify-Fornecedor", timeout=5000)
            print("Prerequisite 'Fornecedor' created.")

        # Create Plano de Contas if it doesn't exist
        page.click("#financeiros-card-link")
        page.click("a[data-tab-financeiro='planos-de-contas']")
        if page.locator("#planos-contas-table-body", has_text="Dashboard-Verify-Categoria").count() == 0:
            page.fill("#plano-conta-nome", "Dashboard-Verify-Categoria")
            page.click("#plano-conta-form button[type='submit']")
            expect(page.locator("#planos-contas-table-body")).to_contain_text("Dashboard-Verify-Categoria", timeout=5000)
            print("Prerequisite 'Plano de Contas' created.")

        # 4. Navigate to Contas a Pagar
        page.click("#financeiro-nav-link-cadastros")
        page.locator("#financeiro-dropdown-cadastros a.nav-link[data-target='contas-a-pagar-page']").click()
        expect(page.locator("#contas-a-pagar-page h1")).to_contain_text("Módulo Financeiro")
        print("Navigated to 'Contas a Pagar'.")

        # 5. Create a new expense to trigger the indicator change
        expense_value = "500.50"
        page.click("#lancar-despesa-btn")
        expect(page.locator("#despesa-modal")).to_be_visible()
        page.fill("#despesa-descricao", "Dashboard Verification Expense")
        page.select_option("#despesa-fornecedor", label="Dashboard-Verify-Fornecedor")
        page.select_option("#despesa-categoria", label="Dashboard-Verify-Categoria")
        page.fill("#despesa-valor", expense_value)
        page.fill("#despesa-competencia", "2025-10-01")
        page.fill("#despesa-vencimento", "2025-10-31")
        page.click("#despesa-form button[type='submit']")
        expect(page.locator("#despesa-modal")).not_to_be_visible(timeout=10000)
        print(f"Created new expense with value: {expense_value}")

        # 6. Navigate back to the main dashboard
        page.click("a.nav-link[data-target='main-page']")
        expect(page.locator("#main-page h1")).to_contain_text("Painel")
        print("Navigated back to Dashboard.")

        # 7. Verify the indicator has updated
        # We need to wait for the value to change from the initial one
        page.wait_for_timeout(1000) # Give a moment for Firestore listener to fire and update UI
        updated_expenses_text = page.locator("#expenses-value").inner_text()
        print(f"Updated 'Despesas Pendentes': {updated_expenses_text}")
        expect(page.locator("#expenses-value")).not_to_have_text(initial_expenses_text, timeout=5000)
        print("Indicator value successfully changed.")

        # 8. Take a screenshot for visual confirmation
        screenshot_path = "jules-scratch/verification/dashboard_indicator_verification.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

    except Exception as e:
        print(f"An error occurred during verification: {e}")
        page.screenshot(path="jules-scratch/verification/error_screenshot.png")

    finally:
        # 9. Cleanup: Delete the created data
        print("Starting cleanup...")
        # Navigate to Contas a Pagar to delete the expense
        page.click("a.nav-link[data-target='contas-a-pagar-page']")
        expect(page.locator("#contas-a-pagar-page")).to_be_visible()

        expense_row = page.locator("#despesas-table-body tr", has_text="Dashboard Verification Expense")
        if expense_row.count() > 0:
            expense_row.locator(".delete-despesa-btn").click()
            print("Cleaned up expense.")

        # Navigate to Cadastros to delete prerequisites
        page.click("a.nav-link[data-target='cadastros-page']")
        expect(page.locator("#cadastros-page")).to_be_visible()

        page.click("#comerciais-card-link")
        fornecedor_row = page.locator("#fornecedores-table-body tr", has_text="Dashboard-Verify-Fornecedor")
        if fornecedor_row.count() > 0:
            fornecedor_row.locator(".delete-btn").click()
            print("Cleaned up 'Fornecedor'.")

        page.click("#financeiros-card-link")
        page.click("a[data-tab-financeiro='planos-de-contas']")
        categoria_row = page.locator("#planos-contas-table-body tr", has_text="Dashboard-Verify-Categoria")
        if categoria_row.count() > 0:
            categoria_row.locator(".delete-btn").click()
            print("Cleaned up 'Plano de Contas'.")

        context.close()
        browser.close()

if __name__ == "__main__":
    with sync_playwright() as p:
        run(p)