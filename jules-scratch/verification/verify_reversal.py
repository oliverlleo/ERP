import re
from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # Step 1: Login as Admin
        page.goto("http://localhost:8000")
        page.get_by_role("link", name="Acesso do Administrador").click()

        admin_modal = page.locator("#admin-login-modal")
        expect(admin_modal).to_be_visible()

        admin_modal.get_by_label("E-mail").fill("test.user@email.com")
        admin_modal.get_by_label("Senha").fill("password")
        admin_modal.get_by_role("button", name="Entrar como Admin").click()

        expect(page.get_by_role("heading", name="Painel")).to_be_visible()
        print("Login successful.")

        # Step 2: Create a selectable expense category (Plano de Contas)
        page.get_by_role("link", name="Cadastros").click()
        expect(page.get_by_role("heading", name="Módulo de Cadastros")).to_be_visible()

        page.locator("#financeiros-card-link").click()
        finance_section = page.locator("#financeiros-cadastro-section")
        expect(finance_section).to_be_visible()

        # Wait for the "DESPESAS" root account to render and then click its "add" button
        despesas_root_account = finance_section.locator("div.p-2", has_text=re.compile(r"^2 - DESPESAS$"))
        add_button = despesas_root_account.get_by_title("Adicionar Sub-conta")

        expect(add_button).to_be_visible()
        add_button.click()

        plano_conta_form = finance_section.locator("#plano-conta-form")
        expect(plano_conta_form).to_be_visible()

        test_category_name = "Serviços de Manutenção"
        plano_conta_form.get_by_label("Nome da Conta").fill(test_category_name)
        plano_conta_form.get_by_label("Analítica (De Lançamento)").check()
        plano_conta_form.get_by_role("button", name="Salvar Conta").click()

        # Wait for the new account to appear in the tree
        expect(finance_section.locator(f"span:has-text('2.1 - {test_category_name}')")).to_be_visible()
        print("Test expense category created.")

        # Step 3: Navigate to Contas a Pagar
        page.get_by_role("button", name="Financeiro").click()
        page.get_by_role("link", name="Contas a Pagar").click()
        expect(page.get_by_role("heading", name="Contas a Pagar")).to_be_visible()
        print("Navigated to Contas a Pagar.")

        # Step 4: Create a new expense using the new category
        page.get_by_role("button", name="Novo", exact=True).click()

        expense_modal = page.locator("#despesa-modal")
        expect(expense_modal.get_by_role("heading", name="Lançar Nova Despesa")).to_be_visible()

        expense_description = "Reparo do Ar Condicionado"
        expense_modal.get_by_label("Descrição").fill(expense_description)
        expense_modal.get_by_label("Tipo de Favorecido").select_option("fornecedores")

        # Wait for payee list and select
        expect(expense_modal.get_by_label("Nome do Favorecido")).not_to_contain_text("Selecione um tipo primeiro")
        expense_modal.get_by_label("Nome do Favorecido").select_option(index=1)

        # Select the newly created category
        expect(expense_modal.get_by_label("Plano de Contas / Categoria").get_by_text(test_category_name)).to_be_visible()
        expense_modal.get_by_label("Plano de Contas / Categoria").select_option(label=f"2.1 - {test_category_name}")

        expense_modal.get_by_label("Valor").fill("350,00")
        expense_modal.get_by_label("Data de Vencimento").fill("2025-12-25")

        expense_modal.get_by_role("button", name="Salvar Lançamento").click()
        print("Expense created.")

        # Step 5: Pay the expense
        row = page.locator(f"//tr[contains(., '{expense_description}')]")
        expect(row).to_be_visible()

        row.get_by_role("checkbox").check()
        page.get_by_role("button", name="Pagar").click()

        payment_modal = page.locator("#pagar-modal")
        expect(payment_modal.get_by_role("heading", name="Registrar Pagamento")).to_be_visible()
        payment_modal.get_by_label("Data do Pagamento").fill("2025-10-08")
        payment_modal.get_by_label("Conta de Saída").select_option(index=1)
        payment_modal.get_by_role("button", name="Confirmar Pagamento").click()

        expect(row.locator("text=Pago")).to_be_visible()
        print("Expense paid.")

        # Step 6: Navigate to Bank Reconciliation
        page.get_by_role("button", name="Financeiro").click()
        page.get_by_role("link", name="Conciliação Bancária").click()
        expect(page.get_by_role("heading", name="Conciliação Bancária")).to_be_visible()
        print("Navigated to Bank Reconciliation.")

        # Step 7: Select account and find the transaction to reverse
        page.get_by_label("Conta Bancária").select_option(index=1)

        mov_row = page.locator(f"//tr[contains(., 'Pagamento: {expense_description}')]")
        expect(mov_row).to_be_visible()
        mov_row.get_by_role("checkbox").check()

        # Step 8: Reverse the transaction
        page.on("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Estornar Lançamento").click()

        expect(page.locator("text=Lançamento estornado com sucesso!")).to_be_visible()
        print("Reversal successful.")

        # Step 9: Verify the reversal in Contas a Pagar
        page.get_by_role("button", name="Financeiro").click()
        page.get_by_role("link", name="Contas a Pagar").click()
        expect(page.get_by_role("heading", name="Contas a Pagar")).to_be_visible()

        reverted_row = page.locator(f"//tr[contains(., '{expense_description}')]")
        expect(reverted_row.locator("text=Vencido")).to_be_visible() # Should be Vencido because due date is in the past
        print("Expense status successfully reverted to 'Vencido'.")

        # Step 10: Take screenshot
        page.screenshot(path="jules-scratch/verification/reversal_verification.png")
        print("Screenshot taken.")

    finally:
        browser.close()

if __name__ == "__main__":
    with sync_playwright() as p:
        run(p)