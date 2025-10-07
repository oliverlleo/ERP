import asyncio
from playwright.async_api import async_playwright, expect
import pathlib

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path to the index.html file
        file_path = str(pathlib.Path('./index.html').resolve())
        await page.goto(f"file://{file_path}")

        # --- Login as Admin ---
        await page.get_by_text("Acesso do Administrador").click()
        await page.locator("#admin-login-email").fill("test.user@email.com")
        await page.locator("#admin-login-password").fill("password")
        await page.get_by_role("button", name="Entrar como Admin").click()
        await expect(page.get_by_text("Painel")).to_be_visible()

        # --- Navigate to Contas a Receber ---
        await page.get_by_role("button", name="Financeiro").click()
        await page.get_by_role("link", name="Contas a Receber").click()
        await expect(page.get_by_text("Contas a Receber")).to_be_visible(timeout=10000)


        # --- Create a new Receivable ---
        await page.get_by_role("button", name="Novo Lançamento").click()
        await expect(page.get_by_text("Lançar Nova Receita")).to_be_visible()
        await page.locator("#receita-descricao").fill("Teste Estorno Receita")
        await page.locator("#receita-valor").fill("150,00")
        await page.locator("#receita-cliente").select_option(label="Cliente Teste")
        await page.locator("#receita-categoria").select_option(label="1.1 - Venda de Projetos")
        await page.locator("#receita-vencimento").fill("2025-10-15")
        await page.locator("#receita-competencia").fill("2025-10-07")
        await page.get_by_role("button", name="Salvar Lançamento").click()
        await expect(page.get_by_text("Teste Estorno Receita")).to_be_visible()

        # --- Register a payment for it ---
        await page.get_by_text("Teste Estorno Receita").click()
        await page.get_by_role("button", name="Registrar Recebimento").click()
        await expect(page.get_by_text("Detalhes do Recebimento")).to_be_visible()
        await page.locator("#receber-conta-entrada").select_option(label="Conta Corrente")
        await page.get_by_role("button", name="Confirmar Recebimento").click()
        await expect(page.get_by_text("Recebido")).to_be_visible()

        # --- Open details and reverse the payment ---
        await page.get_by_text("Teste Estorno Receita").click()
        await page.get_by_role("button", name="Visualizar").click()
        await expect(page.get_by_text("Detalhes da Receita")).to_be_visible()

        # Set up a handler for the prompt dialog
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept("Reversal for testing")))

        await page.get_by_role("button", name="Estornar").click()

        # --- Assert and Screenshot ---
        await expect(page.get_by_text("Estorno")).to_be_visible()
        await expect(page.locator("tbody#recebimentos-history-table-body tr").nth(0).get_by_role("cell").nth(0)).to_have_text("Estorno")
        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

if __name__ == "__main__":
    # Create a dummy client and chart of accounts entry for the test to pass
    # This is a workaround because the test environment is clean
    import firebase_admin
    from firebase_admin import credentials, firestore

    try:
        # Check if the app is already initialized
        firebase_admin.get_app()
    except ValueError:
        # Initialize Firebase Admin SDK
        # The key is base64 encoded in the environment variable
        import base64
        import json
        import os
        key_b64 = os.environ.get('FIREBASE_SERVICE_ACCOUNT_KEY_B64')
        if not key_b64:
            raise ValueError("FIREBASE_SERVICE_ACCOUNT_KEY_B64 environment variable not set.")
        key_json = base64.b64decode(key_b64).decode('utf-8')
        cred = credentials.Certificate(json.loads(key_json))
        firebase_admin.initialize_app(cred, {
            'projectId': 'controle-financeio-85742',
        })

    db = firestore.client()

    # Ensure a test user exists
    user_id = "test-user-123"

    # Create a dummy client
    client_ref = db.collection(f'users/{user_id}/clientes').document('test-client')
    client_ref.set({
        'nome': 'Cliente Teste',
        'razaoSocial': 'Cliente Teste LTDA'
    })

    # Create a dummy bank account
    conta_ref = db.collection(f'users/{user_id}/contasBancarias').document('test-conta')
    conta_ref.set({
        'nome': 'Conta Corrente',
        'saldoInicial': 100000
    })

    # Create a dummy chart of accounts entry
    plano_ref = db.collection(f'users/{user_id}/planosDeContas').document('test-plano')
    plano_ref.set({
        'codigo': '1.1',
        'nome': 'Venda de Projetos',
        'aceitaLancamento': True,
        'aplicavelEm': ['recebimentos'],
        'tipo': 'receita'
    })

    asyncio.run(main())