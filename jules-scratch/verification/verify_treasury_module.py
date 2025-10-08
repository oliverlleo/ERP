import os
from playwright.sync_api import sync_playwright, Page, expect

def verify_treasury_module(page: Page):
    """
    This script verifies the functionality of the new Treasury module.
    It logs in, navigates to the treasury page, selects a bank account,
    and captures a screenshot of the resulting view.
    """
    # 1. Arrange: Go to the application's main page.
    # The application is a static SPA, so we can use a file path.
    full_path = 'file://' + os.path.abspath('index.html')
    page.goto(full_path)

    # 2. Act: Log in as the test user.
    # The app takes a moment to initialize and show the login page.
    # We must wait for the #login-page container to get the 'visible' class.
    login_page_container = page.locator("#login-page")
    expect(login_page_container).to_have_class("view-container min-h-screen w-full visible", timeout=20000)

    # Now that the container is visible, we can interact with its elements.
    login_page_container.get_by_role("link", name="Acesso do Administrador").click()

    # Fill in the admin credentials for the special test user
    page.locator("#admin-login-email").fill("test.user@email.com")
    page.locator("#admin-login-password").fill("password")

    # Click the login button
    page.get_by_role("button", name="Entrar como Admin").click()

    # 3. Act: Navigate to the Treasury page.
    # Wait for the main page to be visible before interacting with the nav
    expect(page.locator("#main-page")).to_be_visible(timeout=10000)

    # Click the main "Financeiro" dropdown button
    page.locator("#financeiro-nav-link").click()

    # Click the link to the new treasury page
    page.get_by_role("link", name="Tesouraria (Extrato)").click()

    # 4. Act: Interact with the Treasury page.
    # Wait for the treasury page container to be visible
    treasury_page_container = page.locator("#movimentacao-bancaria-page")
    expect(treasury_page_container).to_be_visible(timeout=10000)

    # Select the first bank account from the dropdown
    # The value 'some-id-1' is a placeholder, we use the first available option.
    # We wait for the options to be populated by the javascript.
    expect(page.locator("#tesouraria-conta-bancaria > option[value]")).to_have_count(2, timeout=10000) # Wait for options
    page.locator("#tesouraria-conta-bancaria").select_option(index=1)

    # 5. Assert: Wait for the table to show data, indicating the fetch was successful.
    # We look for a row that is NOT the placeholder "Selecione uma conta..." text.
    # A simple way is to wait for the checkbox in the first data row.
    expect(page.locator("#tesouraria-table-body .movimentacao-checkbox").first).to_be_visible(timeout=15000)

    # 6. Screenshot: Capture the final result for visual verification.
    page.screenshot(path="jules-scratch/verification/treasury_module_verification.png")

# Boilerplate to run the script
if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        verify_treasury_module(page)
        browser.close()
    print("Verification script executed and screenshot captured.")