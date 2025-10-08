import os
import re
from playwright.sync_api import sync_playwright, expect

def run_verification(playwright):
    """
    This script verifies the end-to-end flow of reversing a bank transaction
    and ensuring the original expense in 'Contas a Pagar' is reopened.
    """
    # Setup
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Use a local server instead of file:// to ensure JS modules load correctly
    file_path = "http://localhost:8000/index.html"

    # Unique identifier for this test run
    unique_description = f"Despesa de Teste Estorno {os.urandom(4).hex()}"
    expense_value = "150,77"

    try:
        # 1. Go to the app and Log in as Admin
        page.goto(file_path)
        page.wait_for_selector("#login-page.visible")
        page.get_by_text("Acesso do Administrador").click()
        expect(page.locator("#admin-login-modal")).to_be_visible()
        page.locator("#admin-login-email").fill("test.user@email.com")
        page.locator("#admin-login-password").fill("password")
        page.get_by_role("button", name="Entrar como Admin").click()
        expect(page.locator("#main-page")).to_be_visible()
        print("Login successful.")

        # 2. Navigate to Contas a Pagar
        page.get_by_role("button", name="Financeiro").click()
        page.get_by_role("link", name="Contas a Pagar").click()
        expect(page.get_by_role("heading", name="Contas a Pagar")).to_be_visible()
        print("Navigated to Contas a Pagar.")

        # 3. Create a new expense
        page.get_by_role("button", name="Novo", exact=True).click()
        expect(page.locator("#despesa-modal")).to_be_visible()

        # Fill out the form
        page.locator("#despesa-descricao").fill(unique_description)
        page.locator("#favorecido-tipo").select_option("fornecedores")
        expect(page.locator("#favorecido-nome option").nth(1)).to_be_enabled(timeout=10000)
        page.locator("#favorecido-nome").select_option(index=1)

        page.locator("#despesa-categoria").select_option(index=1)
        page.locator("#despesa-valor").fill(expense_value)
        page.locator("#despesa-vencimento").fill("2025-10-15")

        page.get_by_role("button", name="Salvar Lançamento").click()
        expect(page.locator("#despesa-modal")).to_be_hidden()
        print(f"Created expense: {unique_description}")

        # 4. Pay the expense
        expense_row = page.get_by_role("row", name=re.compile(unique_description))
        expect(expense_row).to_be_visible()
        expense_row.get_by_role("checkbox").check()

        page.get_by_role("button", name="Pagar").click()
        expect(page.locator("#pagar-modal")).to_be_visible()

        page.locator("#pagar-conta-saida").select_option(index=1)
        page.get_by_role("button", name="Confirmar Pagamento").click()
        expect(page.locator("#pagar-modal")).to_be_hidden()

        expect(expense_row.get_by_role("cell", name="Pago", exact=True)).to_be_visible(timeout=10000)
        print("Expense paid successfully.")

        # 5. Navigate to Bank Reconciliation
        page.get_by_role("button", name="Financeiro").click()
        page.get_by_role("link", name="Conciliação Bancária").click()
        expect(page.get_by_role("heading", name="Conciliação Bancária")).to_be_visible()
        print("Navigated to Bank Reconciliation.")

        # 6. Find and reverse the transaction
        page.locator("#mov-conta-bancaria-select").select_option(index=1)

        transaction_description = f"Pagamento: {unique_description}"
        transaction_row = page.get_by_role("row", name=re.compile(transaction_description))
        expect(transaction_row).to_be_visible(timeout=10000)
        transaction_row.get_by_role("checkbox").check()

        page.on("dialog", lambda dialog: dialog.accept())

        page.get_by_role("button", name="Estornar Lançamento").click()

        expect(page.get_by_text("Lançamento estornado com sucesso!")).to_be_visible(timeout=10000)
        print("Transaction reversed successfully.")

        # 7. Navigate back to Contas a Pagar
        page.get_by_role("button", name="Financeiro").click()
        page.get_by_role("link", name="Contas a Pagar").click()
        expect(page.get_by_role("heading", name="Contas a Pagar")).to_be_visible()
        print("Navigated back to Contas a Pagar.")

        # 8. Verify the expense is reopened
        reopened_expense_row = page.get_by_role("row", name=re.compile(unique_description))

        expect(reopened_expense_row.get_by_role("cell", name="Pago", exact=True)).to_be_hidden()

        formatted_value = f"R$ {expense_value.replace('.', ',')}"
        expect(reopened_expense_row.get_by_role("cell", name=formatted_value).first).to_be_visible()
        print("Expense successfully reopened with correct balance.")

        # 9. Take a screenshot for final verification
        screenshot_path = "jules-scratch/verification/reversal_verification.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")
        raise
    finally:
        browser.close()

if __name__ == "__main__":
    with sync_playwright() as p:
        run_verification(p)