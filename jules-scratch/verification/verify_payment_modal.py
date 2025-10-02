import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Get the absolute path to the index.html file
        import os
        file_path = os.path.abspath('index.html')

        await page.goto(f'file://{file_path}')

        # Use a client-side script to set up a test environment
        await page.evaluate('() => { window.IS_TEST_RUN = true; }')

        # --- Login and Navigate ---
        # Use test credentials to log in
        await page.locator("#admin-login-link").click()
        await page.locator("#admin-login-email").fill("test.user@email.com")
        await page.locator("#admin-login-password").fill("password")
        await page.locator("#admin-login-form button[type='submit']").click()

        # Wait for the main page to be visible
        await expect(page.locator("#main-page")).to_be_visible()

        # Navigate to "Contas a Pagar" by first clicking the dropdown
        await page.locator('#financeiro-nav-link').click()
        await page.locator('.nav-link[data-target="contas-a-pagar-page"]').first.click()
        await expect(page.locator("#contas-a-pagar-page")).to_be_visible()

        # --- Verification for Payment Modal ---
        # 1. Prepare test data and open the modal
        await page.evaluate('''() => {
            // Mock opening the payment modal for a test expense
            document.getElementById('pagar-despesa-id').value = 'test-expense-1';
            const valorInput = document.getElementById('pagar-valor');
            valorInput.value = '1000.00';
            valorInput.readOnly = false; // Ensure it's editable for the test

            // Trigger the calculation to initially set the final value
            const pagarJurosMultaInput = document.getElementById('pagar-juros-multa');
            pagarJurosMultaInput.dispatchEvent(new Event('input'));

            document.getElementById('pagar-modal').classList.remove('hidden');
        }''')

        # 2. Interact with the new fields
        await page.locator('#pagar-juros-multa').fill('100.50')
        await page.locator('#pagar-descontos').fill('50.25')

        # 3. Assert the final value is calculated correctly
        # Expected: (1000 + 100.50) - 50.25 = 1050.25
        await expect(page.locator('#pagar-valor-final')).to_have_value('1050.25')

        # 4. Take a screenshot of the payment modal
        await page.locator('#pagar-modal').screenshot(path="jules-scratch/verification/01_payment_modal.png")
        print("Screenshot of payment modal taken.")

        # Close the payment modal
        await page.locator('#close-pagar-modal-btn').click()

        # --- Verification for Visualization Modal ---
        # 1. Prepare mock data for a paid expense with discounts/fees
        await page.evaluate('''() => {
            const data = {
                descricao: 'Test Expense with Fees',
                favorecidoNome: 'Test Supplier',
                categoriaId: 'test-cat-1',
                obs: 'Observation text',
                emissao: '2025-10-01',
                competencia: '2025-10-01',
                vencimento: '2025-10-15',
                criadoPor: 'Jules',
                createdAt: { toDate: () => new Date() },
                numeroDocumento: 'DOC-001',
                valor: 1000,
                pago: true,
                dataPagamento: '2025-10-02',
                valorPago: 1050.25,
                contaSaidaId: 'test-account-1',
                descontos: 50.25,
                jurosMulta: 100.50,
            };

            // Mock the openVisualizarModal function to use this data
            window.openVisualizarModal = async (despesaId) => {
                document.getElementById('view-despesa-descricao').textContent = data.descricao;
                document.getElementById('view-despesa-favorecido').textContent = data.favorecidoNome;
                document.getElementById('view-despesa-categoria').textContent = 'Test Category';
                document.getElementById('view-despesa-obs').textContent = data.obs;
                document.getElementById('view-despesa-emissao').textContent = new Date(data.emissao + 'T00:00:00').toLocaleDateString('pt-BR');
                document.getElementById('view-despesa-competencia').textContent = new Date(data.competencia + 'T00:00:00').toLocaleDateString('pt-BR');
                document.getElementById('view-despesa-vencimento').textContent = new Date(data.vencimento + 'T00:00:00').toLocaleDateString('pt-BR');
                document.getElementById('view-despesa-criado-por').textContent = data.criadoPor;
                document.getElementById('view-despesa-criado-em').textContent = data.createdAt.toDate().toLocaleString('pt-BR');
                document.getElementById('view-despesa-numero-documento').textContent = data.numeroDocumento;
                document.getElementById('view-despesa-valor').textContent = (1000).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                document.getElementById('view-despesa-status').textContent = 'Pago';
                document.getElementById('view-despesa-status').className = 'text-base font-medium text-green-600';

                const pagamentoInfoEl = document.getElementById('view-pagamento-info');
                document.getElementById('view-despesa-data-pagamento').textContent = new Date(data.dataPagamento + 'T00:00:00').toLocaleDateString('pt-BR');
                document.getElementById('view-despesa-valor-pago').textContent = data.valorPago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                document.getElementById('view-despesa-conta-saida').textContent = 'Test Account';

                const descontosContainer = document.getElementById('view-despesa-descontos-container');
                if (data.descontos > 0) {
                    document.getElementById('view-despesa-descontos').textContent = data.descontos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    descontosContainer.classList.remove('hidden');
                }
                const jurosMultaContainer = document.getElementById('view-despesa-juros-multa-container');
                if (data.jurosMulta > 0) {
                    document.getElementById('view-despesa-juros-multa').textContent = data.jurosMulta.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    jurosMultaContainer.classList.remove('hidden');
                }

                pagamentoInfoEl.classList.remove('hidden');
                document.getElementById('visualizar-despesa-modal').classList.remove('hidden');
            };

            // Now call the mocked function
            window.openVisualizarModal('mock-id');
        }''')

        # 2. Wait for the modal to be visible and take a screenshot
        await expect(page.locator("#visualizar-despesa-modal")).to_be_visible()
        await page.locator('#visualizar-despesa-modal').screenshot(path="jules-scratch/verification/02_visualization_modal.png")
        print("Screenshot of visualization modal taken.")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())