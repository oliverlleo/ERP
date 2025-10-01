from playwright.sync_api import Page, expect, Browser
import pytest

def test_finance_module(browser: Browser):
    """
    End-to-end test for the finance module (Contas a Pagar).
    """
    # It's better to create a new context for each test to ensure isolation.
    context = browser.new_context(no_viewport=True)
    page = context.new_page()

    # Capture console logs - Corrected: msg.text is a property, not a method.
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    page.on("dialog", lambda dialog: dialog.accept())

    try:
        page.goto("http://localhost:8000")

        # 1. Log in
        page.fill("#login-email", "test.user@email.com")
        page.fill("#login-password", "password123")
        page.click("button[type='submit']")
        expect(page.locator("#main-page")).to_be_visible(timeout=10000)

        # 2. Prerequisite Data Creation
        page.click("a.nav-link[data-target='cadastros-page']")
        expect(page.locator("#cadastros-page")).to_be_visible()

        # Fornecedor
        page.click("#comerciais-card-link")
        page.fill("#fornecedor-nome", "Fornecedor Teste Playwright")
        page.click("#fornecedor-form button[type='submit']")
        expect(page.locator("#fornecedores-table-body")).to_contain_text("Fornecedor Teste Playwright", timeout=5000)

        # Plano de Contas & Conta Bancária
        page.click("#financeiros-card-link")
        page.click("a[data-tab-financeiro='planos-de-contas']")
        page.fill("#plano-conta-nome", "Categoria Teste Playwright")
        page.click("#plano-conta-form button[type='submit']")
        expect(page.locator("#planos-contas-table-body")).to_contain_text("Categoria Teste Playwright", timeout=5000)

        page.click("a[data-tab-financeiro='contas-bancarias']")
        page.fill("#conta-bancaria-nome", "Conta Teste Playwright")
        page.click("#conta-bancaria-form button[type='submit']")
        expect(page.locator("#contas-bancarias-table-body")).to_contain_text("Conta Teste Playwright", timeout=5000)

        # 3. Navigate to Contas a Pagar
        page.click("#financeiro-nav-link-cadastros")
        page.locator("#financeiro-dropdown-cadastros a.nav-link[data-target='contas-a-pagar-page']").click()
        expect(page.locator("#contas-a-pagar-page h1")).to_contain_text("Módulo Financeiro")

        # 4. Create a new expense
        page.click("#lancar-despesa-btn")
        expect(page.locator("#despesa-modal")).to_be_visible()
        page.fill("#despesa-descricao", "Despesa de Teste E2E")
        page.select_option("#despesa-fornecedor", label="Fornecedor Teste Playwright")
        page.select_option("#despesa-categoria", label="Categoria Teste Playwright")
        page.fill("#despesa-valor", "150.75")
        page.fill("#despesa-competencia", "2025-09-30")
        page.fill("#despesa-vencimento", "2025-10-15")
        page.click("#despesa-form button[type='submit']")

        # 5. Verify expense in table
        expect(page.locator("#despesa-modal")).not_to_be_visible(timeout=10000)
        despesa_row = page.locator("#despesas-table-body tr", has_text="Despesa de Teste E2E")
        expect(despesa_row).to_be_visible(timeout=10000)
        expect(despesa_row).to_contain_text("Pendente")

        # 6. Pay the expense
        despesa_row.locator(".pagar-despesa-btn").click()
        expect(page.locator("#pagar-modal")).to_be_visible()
        page.select_option("#pagar-conta-saida", label="Conta Teste Playwright")
        page.fill("#pagar-data", "2025-10-01")
        page.click("#pagar-form button[type='submit']")

        # 7. Verify payment
        expect(page.locator("#pagar-modal")).not_to_be_visible(timeout=10000)
        expect(despesa_row.locator("td", has_text="Pago")).to_be_visible(timeout=10000)

        # 8. Delete the expense
        despesa_row.locator(".delete-despesa-btn").click()

        # 9. Verify deletion
        expect(despesa_row).not_to_be_visible(timeout=10000)

    finally:
        # 10. Cleanup
        # This part is critical for ensuring tests are idempotent.
        page.goto("http://localhost:8000")

        page.fill("#login-email", "test.user@email.com")
        page.fill("#login-password", "password123")
        page.click("button[type='submit']")
        expect(page.locator("#main-page")).to_be_visible(timeout=10000)

        page.click("a.nav-link[data-target='cadastros-page']")
        expect(page.locator("#cadastros-page")).to_be_visible()

        # Delete Fornecedor
        page.click("#comerciais-card-link")
        while page.locator("#fornecedores-table-body tr", has_text="Fornecedor Teste Playwright").count() > 0:
            page.locator("#fornecedores-table-body tr", has_text="Fornecedor Teste Playwright").first.locator(".delete-btn").click()
            page.wait_for_timeout(200) # Brief pause for UI update

        # Delete Plano de Contas & Conta Bancária
        page.click("#financeiros-card-link")
        page.click("a[data-tab-financeiro='planos-de-contas']")
        while page.locator("#planos-contas-table-body tr", has_text="Categoria Teste Playwright").count() > 0:
            page.locator("#planos-contas-table-body tr", has_text="Categoria Teste Playwright").first.locator(".delete-btn").click()
            page.wait_for_timeout(200) # Brief pause for UI update

        page.click("a[data-tab-financeiro='contas-bancarias']")
        while page.locator("#contas-bancarias-table-body tr", has_text="Conta Teste Playwright").count() > 0:
            page.locator("#contas-bancarias-table-body tr", has_text="Conta Teste Playwright").first.locator(".delete-btn").click()
            page.wait_for_timeout(200) # Brief pause for UI update

        context.close()