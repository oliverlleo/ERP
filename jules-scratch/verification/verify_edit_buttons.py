import asyncio
from playwright.sync_api import sync_playwright, expect
import pathlib

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        file_path = (pathlib.Path.cwd() / "index.html").as_uri()

        page.add_init_script("window.IS_TEST_RUN = true;")
        # Changed to networkidle and added an explicit wait for the page container
        page.goto(file_path, wait_until="networkidle")
        expect(page.locator("#login-page")).to_be_visible(timeout=10000)

        # 1. Login as Admin
        page.locator("#admin-login-link").click()
        expect(page.locator("#admin-login-modal")).to_be_visible()
        page.locator("#admin-login-email").fill("test.user@email.com")
        page.locator("#admin-login-password").fill("password")
        page.locator("#admin-login-form button[type='submit']").click()

        expect(page.locator("#main-page")).to_be_visible(timeout=10000)

        # 2. Navigate to Cadastros
        page.get_by_role("link", name="Cadastros").click()
        expect(page.locator("#cadastros-page")).to_be_visible()

        # --- VERIFY SERVIÇOS ---
        page.locator("#comerciais-card-link").click()
        expect(page.locator("#comerciais-cadastro-section")).to_be_visible()
        page.get_by_role("link", name="Serviços", exact=True).click()

        # Inject mock row to demonstrate the button
        page.evaluate('''() => {
            const tableBody = document.getElementById('servicos-table-body');
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr data-id="mock-servico-1">
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">Serviço de Pintura</td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button class="edit-servico-btn text-indigo-600 hover:text-indigo-900 mr-4" data-id="mock-servico-1">Editar</button>
                            <button class="delete-btn text-red-600 hover:text-red-900" data-id="mock-servico-1">Excluir</button>
                        </td>
                    </tr>`;
            }
        }''')

        # Take screenshot of the "Serviços" table
        page.screenshot(path="jules-scratch/verification/servicos-verification.png")

        # --- VERIFY PLANOS DE CONTAS ---
        page.locator("#financeiros-card-link").click()
        expect(page.locator("#financeiros-cadastro-section")).to_be_visible()
        page.get_by_role("link", name="Planos de Contas", exact=True).click()

        # Inject mock row
        page.evaluate('''() => {
            const tableBody = document.getElementById('planos-contas-table-body');
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr data-id="mock-plano-1">
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">Despesas Operacionais</td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button class="edit-plano-conta-btn text-indigo-600 hover:text-indigo-900 mr-4" data-id="mock-plano-1">Editar</button>
                            <button class="delete-btn text-red-600 hover:text-red-900" data-id="mock-plano-1">Excluir</button>
                        </td>
                    </tr>`;
            }
        }''')

        # Take screenshot of the "Planos de Contas" table
        page.screenshot(path="jules-scratch/verification/planos-contas-verification.png")

        print("Verification screenshots created successfully.")

    finally:
        context.close()
        browser.close()

with sync_playwright() as p:
    run_verification(p)