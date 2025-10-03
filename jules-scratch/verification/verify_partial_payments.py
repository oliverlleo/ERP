import time
from playwright.sync_api import sync_playwright, Page, expect

def create_supplier(page: Page):
    print("Creating supplier...")
    page.get_by_role("link", name="Cadastros").click()
    page.get_by_role("link", name="Comerciais e Logísticos").click()
    comerciais_section = page.locator("#comerciais-cadastro-section")
    expect(comerciais_section.get_by_role("heading", name="Comerciais e Logísticos")).to_be_visible(timeout=5000)

    fornecedor_form = comerciais_section.locator("#fornecedor-form")
    fornecedor_form.get_by_label("Razão Social").fill("Fornecedor de Teste")
    fornecedor_form.get_by_label("CNPJ").fill("00.000.000/0000-00")
    fornecedor_form.get_by_role("button", name="Salvar Fornecedor").click()
    expect(page.get_by_text("Fornecedor salvo com sucesso!")).to_be_visible()
    print("Supplier created.")

def create_bank_account(page: Page):
    print("Creating bank account...")
    page.get_by_role("link", name="Cadastros").click()
    page.get_by_role("link", name="Financeiros e Contábeis").click()
    financeiros_section = page.locator("#financeiros-cadastro-section")
    expect(financeiros_section.get_by_role("heading", name="Financeiros e Contábeis")).to_be_visible(timeout=5000)

    financeiros_section.get_by_role("link", name="Contas Bancárias").click()
    conta_bancaria_form = financeiros_section.locator("#conta-bancaria-form")
    conta_bancaria_form.get_by_label("Nome da Conta").fill("Conta de Teste")
    conta_bancaria_form.get_by_role("button", name="Salvar Conta").click()
    expect(page.get_by_text("Conta salva com sucesso!")).to_be_visible()
    print("Bank account created.")

def create_category(page: Page):
    print("Creating category...")
    page.get_by_role("link", name="Cadastros").click()
    page.get_by_role("link", name="Financeiros e Contábeis").click()
    financeiros_section = page.locator("#financeiros-cadastro-section")
    expect(financeiros_section.get_by_role("heading", name="Financeiros e Contábeis")).to_be_visible(timeout=5000)

    financeiros_section.get_by_role("link", name="Planos de Contas").click()
    plano_conta_form = financeiros_section.locator("#plano-conta-form")
    plano_conta_form.get_by_label("Nome da Categoria").fill("Categoria de Teste")
    plano_conta_form.get_by_role("button", name="Salvar Categoria").click()
    expect(page.get_by_text("Categoria salva com sucesso!")).to_be_visible()
    print("Category created.")

def run_verification(page: Page):
    """
    Verifies the entire partial payment flow.
    """
    unique_desc = f"Despesa de Teste {int(time.time())}"

    # 1. Login
    print("Logging in...")
    page.goto(f"file:///app/index.html", timeout=30000)
    page.get_by_role("link", name="Acesso do Administrador").click()
    admin_modal = page.locator("#admin-login-modal")
    admin_modal.get_by_label("E-mail").fill("test.user@email.com")
    admin_modal.get_by_label("Senha").fill("password")
    admin_modal.get_by_role("button", name="Entrar como Admin").click()
    expect(page.locator("#main-page").get_by_role("heading", name="Painel")).to_be_visible(timeout=10000)
    print("Logged in.")

    # 2. Setup Data
    create_supplier(page)
    create_bank_account(page)
    create_category(page)

    # 3. Navigate to Contas a Pagar
    print("Navigating to Contas a Pagar...")
    page.get_by_role("button", name="Financeiro").click()
    page.get_by_role("link", name="Contas a Pagar").click()
    expect(page.get_by_role("heading", name="Módulo Financeiro")).to_be_visible()
    print("On Contas a Pagar page.")

    # 4. Create a new expense
    print("Creating expense...")
    page.get_by_role("button", name="Novo").click()
    despesa_modal = page.locator("#despesa-modal")
    expect(despesa_modal.get_by_role("heading", name="Lançar Nova Despesa")).to_be_visible()

    despesa_modal.get_by_label("Descrição").fill(unique_desc)
    despesa_modal.locator("#despesa-valor").fill("1500.75")
    despesa_modal.get_by_label("Data de Vencimento").fill("2025-11-20")
    despesa_modal.get_by_label("Data de Competência").fill("2025-11-01")

    despesa_modal.get_by_label("Tipo de Favorecido").select_option("fornecedores")
    # Wait for the options to load. A short, simple wait is acceptable for this verification script.
    page.wait_for_timeout(500)
    despesa_modal.get_by_label("Nome do Favorecido").select_option(label="Fornecedor de Teste")

    despesa_modal.get_by_label("Plano de Contas / Categoria").select_option(label="Categoria de Teste")

    despesa_modal.get_by_role("button", name="Salvar Lançamento").click()
    print("Expense created.")

    # Wait for table to render
    expect(page.get_by_text(unique_desc)).to_be_visible(timeout=10000)

    # 5. Make a partial payment
    print("Making partial payment...")
    page.locator(f'tr:has-text("{unique_desc}")').get_by_role("checkbox").check()
    page.get_by_role("button", name="Pagar").click()

    pagar_modal = page.locator("#pagar-modal")
    expect(pagar_modal.get_by_role("heading", name="Registrar Pagamento")).to_be_visible()
    expect(pagar_modal.locator("#pagar-saldo-devedor")).to_contain_text("R$ 1.500,75")

    pagar_modal.get_by_label("Valor a Pagar (R$)").fill("500.25")
    pagar_modal.get_by_label("Conta de Saída").select_option(label="Conta de Teste")
    pagar_modal.get_by_role("button", name="Confirmar Pagamento").click()
    print("Partial payment submitted.")

    # 6. Verify status and open details
    expect(page.locator(f'tr:has-text("{unique_desc}")').get_by_text("Pago Parcialmente")).to_be_visible()
    print("Status is 'Pago Parcialmente'.")

    page.locator(f'tr:has-text("{unique_desc}")').get_by_role("checkbox").check()
    page.get_by_role("button", name="Visualizar").click()

    print("Viewing details...")
    expect(page.get_by_role("heading", name="Detalhes da Despesa")).to_be_visible()

    # 7. Assertions in the modal
    expect(page.locator("#view-despesa-valor")).to_have_text("R$ 1.500,75")
    expect(page.locator("#view-despesa-saldo")).to_have_text("R$ 1.000,50")
    expect(page.locator("#view-despesa-status")).to_have_text("Pago Parcialmente")

    history_table = page.locator("#view-pagamentos-table-body")
    expect(history_table.get_by_role("cell", name="R$ 500,25")).to_be_visible()
    expect(history_table.get_by_role("cell", name="Conta de Teste")).to_be_visible()
    print("Assertions in modal passed.")

    # 8. Screenshot
    page.screenshot(path="jules-scratch/verification/partial_payment_verification.png")
    print("Screenshot taken.")


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            run_verification(page)
            print("Verification script ran successfully.")
        except Exception as e:
            print(f"Verification script failed: {e}")
            page.screenshot(path="jules-scratch/verification/error.png")
            raise
        finally:
            browser.close()