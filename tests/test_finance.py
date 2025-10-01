import re
from playwright.sync_api import Page, expect

def test_finance_module(page: Page):
    """
    End-to-end test for the finance module (Contas a Pagar).
    1. Logs in.
    2. Navigates to Cadastros to create prerequisite data:
        - A new Fornecedor (Supplier).
        - A new Plano de Contas (Chart of Accounts).
        - A new Conta Bancária (Bank Account).
    3. Navigates to the Contas a Pagar page.
    4. Opens the 'Lançar Nova Despesa' modal.
    5. Verifies the created items from step 2 exist in the dropdowns.
    6. Creates a new expense.
    7. Verifies the expense is added to the table with 'Pendente' status.
    8. Edits the expense to mark it as 'Pago'.
    9. Verifies the expense status updates in the table.
    10. Deletes the expense.
    11. Verifies the expense is removed from the table.
    """
    # Go to the app
    page.goto("http://localhost:8000")

    # 1. Log in
    page.fill("#login-email", "test.user@email.com")
    page.fill("#login-password", "password123")
    page.click("button[type='submit']")

    # Expect the main page to be visible
    expect(page.locator("#main-page")).to_be_visible(timeout=10000)
    expect(page.locator("#main-page h1")).to_contain_text("Painel")

    # 2. Navigate to Cadastros
    page.click("a.nav-link[data-target='cadastros-page']")
    expect(page.locator("#cadastros-page")).to_be_visible()
    expect(page.locator("#cadastros-page h1")).to_contain_text("Módulo de Cadastros")

    # --- Create Prerequisite Data ---

    # a. Create a new Fornecedor
    page.click("#comerciais-card-link")
    expect(page.locator("#comerciais-cadastro-section")).to_be_visible()
    page.fill("#fornecedor-nome", "Fornecedor Teste Playwright")
    page.fill("#fornecedor-cnpj", "12.345.678/0001-99")
    page.click("#fornecedor-form button[type='submit']")
    expect(page.locator("#fornecedores-table-body")).to_contain_text("Fornecedor Teste Playwright")

    # b. Create a new Plano de Contas
    page.click("#financeiros-card-link")
    expect(page.locator("#financeiros-cadastro-section")).to_be_visible()
    # Click tab "Planos de Contas"
    page.click("a[data-tab-financeiro='planos-de-contas']")
    page.fill("#plano-conta-nome", "Categoria Teste Playwright")
    page.click("#plano-conta-form button[type='submit']")
    expect(page.locator("#planos-contas-table-body")).to_contain_text("Categoria Teste Playwright")

    # c. Create a new Conta Bancária
    page.click("a[data-tab-financeiro='contas-bancarias']")
    page.fill("#conta-bancaria-nome", "Conta Teste Playwright")
    page.click("#conta-bancaria-form button[type='submit']")
    expect(page.locator("#contas-bancarias-table-body")).to_contain_text("Conta Teste Playwright")

    # 3. Navigate to Contas a Pagar page
    page.click("#financeiro-nav-link-cadastros")
    # Use a more specific locator for the link within the now-visible dropdown
    page.locator("#financeiro-dropdown-cadastros a.nav-link[data-target='contas-a-pagar-page']").click()
    expect(page.locator("#contas-a-pagar-page")).to_be_visible()
    expect(page.locator("#contas-a-pagar-page h1")).to_contain_text("Módulo Financeiro")

    # 4. Open the 'Lançar Nova Despesa' modal
    page.click("#lancar-despesa-btn")
    expect(page.locator("#despesa-modal")).to_be_visible()
    expect(page.locator("#despesa-modal h3")).to_contain_text("Lançar Nova Despesa")

    # 5. Verify dropdowns are populated
    expect(page.locator("#despesa-fornecedor")).to_contain_text("Fornecedor Teste Playwright")
    expect(page.locator("#despesa-categoria")).to_contain_text("Categoria Teste Playwright")

    # 6. Create a new expense
    page.fill("#despesa-descricao", "Despesa de Teste E2E")
    page.select_option("#despesa-fornecedor", label="Fornecedor Teste Playwright")
    page.select_option("#despesa-categoria", label="Categoria Teste Playwright")
    page.fill("#despesa-valor", "150.75")
    page.fill("#despesa-competencia", "2025-09-30")
    page.fill("#despesa-vencimento", "2025-10-15")
    page.click("#despesa-form button[type='submit']")

    # 7. Verify the expense is in the table with 'Pendente' status
    expect(page.locator("#despesa-modal")).not_to_be_visible()
    expense_row = page.locator("#despesas-table-body tr", has_text="Despesa de Teste E2E")
    expect(expense_row).to_be_visible()
    expect(expense_row).to_contain_text("Fornecedor Teste Playwright")
    expect(expense_row).to_contain_text("15/10/2025")
    expect(expense_row).to_contain_text("R$ 150,75")
    expect(expense_row.locator("span")).to_have_text(re.compile("Pendente"))
    expect(expense_row.locator("span")).to_have_class(re.compile("bg-yellow-100"))

    # 8. Edit the expense to mark as 'Pago'
    expense_row.locator("button.edit-despesa-btn").click()
    expect(page.locator("#despesa-modal")).to_be_visible()
    expect(page.locator("#despesa-modal h3")).to_contain_text("Editar Despesa")

    # Mark as paid and fill payment info
    page.check("#marcar-pago-checkbox")
    expect(page.locator("#pagamento-info")).to_be_visible()
    expect(page.locator("#pagamento-conta")).to_contain_text("Conta Teste Playwright")
    page.fill("#pagamento-data", "2025-09-30")
    page.fill("#pagamento-valor", "150.75")
    page.select_option("#pagamento-conta", label="Conta Teste Playwright")

    page.click("#despesa-form button[type='submit']")

    # 9. Verify status is updated to 'Pago'
    expect(page.locator("#despesa-modal")).not_to_be_visible()
    expect(expense_row).to_be_visible() # Re-check the same row
    expect(expense_row.locator("span")).to_have_text(re.compile("Pago"))
    expect(expense_row.locator("span")).to_have_class(re.compile("bg-green-100"))

    # 10. Delete the expense
    page.on("dialog", lambda dialog: dialog.accept()) # Handle confirmation dialog
    expense_row.locator("button.delete-despesa-btn").click()

    # 11. Verify the expense is removed
    expect(expense_row).not_to_be_visible()

    # Take screenshot
    page.screenshot(path="tests/screenshots/finance_module.png")
    print("Test finished. Screenshot captured.")