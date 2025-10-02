import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(15000) # Increased timeout for slower operations

        try:
            await page.goto("file:///app/index.html")

            # --- 1. Login as Admin to set up data ---
            await page.locator("#admin-login-link").click()
            await expect(page.locator("#admin-login-modal")).to_be_visible()
            await page.locator("#admin-login-email").fill("test.admin@test.com")
            await page.locator("#admin-login-password").fill("admin123")

            # Use a special test-only login that bypasses Firebase auth
            # In the app, this is handled by checking for a specific test email.
            # For this script, we'll simulate the outcome by directly setting test state
            # via a custom event if this were a real app, but for now we assume
            # the app's test login logic works.
            # We'll rely on the existing test user logic in the app.
            await page.locator("#admin-login-email").fill("test.user@email.com")
            await page.locator("#admin-login-form button[type='submit']").click()
            await expect(page.locator("#main-page")).to_be_visible()
            print("Admin login successful.")

            # --- 2. Create prerequisite data ---
            await page.locator('#main-page header nav a[data-target="cadastros-page"]').click()
            await expect(page.locator("#cadastros-page")).to_be_visible()
            print("Navigated to Cadastros page.")

            # Create Fornecedor
            await page.locator("#comerciais-card-link").click()
            await page.locator(".tab-link-comercial[data-tab-comercial='fornecedores']").click()
            await page.locator("#fornecedor-razao-social").fill("Fornecedor de Teste")
            await page.locator("#fornecedor-form button[type='submit']").click()
            await page.wait_for_timeout(500) # Wait for UI update
            print("Fornecedor created.")

            # Create Plano de Contas
            await page.locator("#financeiros-card-link").click()
            await page.locator(".tab-link-financeiro[data-tab-financeiro='planos-de-contas']").click()
            await page.locator("#plano-conta-nome").fill("Aluguel")
            await page.locator("#plano-conta-form button[type='submit']").click()
            await page.wait_for_timeout(500)
            print("Plano de Contas created.")

            # Create Empresa
            await page.locator("#gerais-card-link").click()
            await page.locator(".tab-link[data-tab='empresas']").click()
            await page.locator("#empresa-nome").fill("Empresa de Teste Final")
            await page.locator("#empresa-cnpj").fill("00.000.000/0001-00")
            await page.locator("#empresa-form button[type='submit']").click()
            await page.wait_for_timeout(500)
            print("Empresa created.")

            # Create Funcionário
            await page.locator("#rh-card-link").click()
            await page.locator("#funcionario-nome-completo").fill("Usuário de Teste")
            await page.locator("#funcionario-empresa").select_option(label="Empresa de Teste Final")
            await page.locator("#funcionario-form button[type='submit']").click()
            await page.wait_for_timeout(500)
            print("Funcionário created.")

            # Create Usuário do Sistema
            await page.locator("#gerais-card-link").click()
            await page.locator(".tab-link[data-tab='usuarios']").click()
            await page.locator("#usuario-funcionario-select").select_option(label="Usuário de Teste")
            await page.locator("#usuario-form button[type='submit']").click()
            await page.wait_for_timeout(500)
            print("Usuário do Sistema created.")

            # Create Acesso
            await page.locator(".tab-link[data-tab='perfis']").click()
            await page.locator("#acesso-usuario-select").select_option(label="Usuário de Teste")
            await page.locator("#acesso-login-nome").fill("userteste")
            await page.locator("#perfil-form-button").click()
            await page.wait_for_timeout(500)
            print("Acesso created.")

            # --- 3. Logout Admin ---
            await page.locator("#profile-button-cadastros").click()
            await page.locator("#logout-button-cadastros").click()
            await expect(page.locator("#login-page")).to_be_visible()
            print("Admin logged out.")

            # --- 4. Login as Regular User with Temporary Password ---
            await page.locator("#login-empresa").select_option(label="Empresa de Teste Final")
            await page.locator("#login-usuario").fill("userteste")
            await page.locator("#login-password").fill("123456") # Use the deterministic temporary password
            await page.locator("#user-login-form button[type='submit']").click()

            # --- Handle Forced Password Change ---
            await expect(page.locator("#change-password-modal")).to_be_visible()
            print("Password change modal appeared as expected.")
            await page.locator("#new-password").fill("newpassword123")
            await page.locator("#confirm-password").fill("newpassword123")
            await page.locator("#change-password-form button[type='submit']").click()

            await expect(page.locator("#main-page")).to_be_visible()
            print("Regular user login and password change successful.")

            # --- 5. Navigate and create expense ---
            await page.locator('#financeiro-nav-link').click()
            await page.locator('a.nav-link[data-target="contas-a-pagar-page"]').click()
            await expect(page.locator("#contas-a-pagar-page")).to_be_visible()

            await page.locator("#lancar-despesa-btn").click()
            await expect(page.locator("#despesa-modal")).to_be_visible()
            await page.locator("#despesa-descricao").fill("Despesa de Teste Final")
            await page.locator("#favorecido-tipo").select_option("fornecedores")
            await page.locator("#favorecido-nome").select_option(label="Fornecedor de Teste")
            await page.locator("#despesa-categoria").select_option(label="Aluguel")
            await page.locator("#despesa-valor").fill("2000")
            await page.locator("#despesa-vencimento").fill("2025-11-10")
            await page.locator("#despesa-form button[type='submit']").click()
            await expect(page.locator("#despesa-modal")).to_be_hidden()
            print("Expense created successfully.")

            # --- 6. Open Payment Modal and Verify ---
            await page.wait_for_timeout(1000)
            await page.locator('td:has-text("Despesa de Teste Final")').first.get_by_role("checkbox").check()
            pagar_btn = page.locator("#pagar-selecionadas-btn")
            await expect(pagar_btn).to_be_enabled()
            await pagar_btn.click()

            await expect(page.locator("#pagar-modal")).to_be_visible()
            print("Payment modal opened.")

            await expect(page.locator("#pagar-descontos")).to_be_visible()
            await expect(page.locator("#pagar-juros-multa")).to_be_visible()
            await expect(page.locator("#pagar-valor-final")).to_be_visible()
            print("New payment fields are visible.")

            await page.locator("#pagar-valor").fill("2000")
            await page.locator("#pagar-juros-multa").fill("100")
            await page.locator("#pagar-descontos").fill("50")

            await expect(page.locator("#pagar-valor-final")).to_have_value("2050.00")
            print("Final value calculation is correct.")

            await page.screenshot(path="jules-scratch/verification/payment_modal_full_flow.png")
            print("Screenshot taken successfully.")

        except Exception as e:
            print(f"An error occurred during verification: {e}")
            await page.screenshot(path="jules-scratch/verification/error.png")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())