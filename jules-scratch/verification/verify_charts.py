import asyncio
from playwright.sync_api import sync_playwright, expect
import os

def run_verification(page):
    """
    Navigates to the cash flow charts page and takes a screenshot.
    """
    # Get the absolute path to the index.html file
    # The script is run from the root of the repo, so the path is relative to that.
    file_path = "file://" + os.path.abspath("index.html")

    # 1. Navigate to the local file
    page.goto(file_path)

    # Wait for the login page to become visible
    expect(page.locator("#login-page")).to_be_visible()

    # 2. Perform admin login
    page.click("#admin-login-link")
    expect(page.locator("#admin-login-modal")).to_be_visible()
    page.fill("#admin-login-email", "test.user@email.com")
    page.fill("#admin-login-password", "password123")
    page.click("#admin-login-form button[type='submit']")

    # 3. Navigate to Fluxo de Caixa
    # Wait for the main page to be visible after login
    expect(page.locator("#main-page")).to_be_visible()

    # Click the main "Financeiro" dropdown in the header
    page.click("#financeiro-nav-link")

    # Click the "Fluxo de Caixa" link within the dropdown
    # We need to ensure we're clicking the right one, so we target it within the dropdown
    dropdown_link = page.locator('#financeiro-dropdown .nav-link[data-target="fluxo-de-caixa-page"]')
    expect(dropdown_link).to_be_visible()
    dropdown_link.click()

    # 4. Switch to the "Gráficos" tab
    # Wait for the cash flow page to load
    expect(page.locator("#fluxo-de-caixa-page")).to_be_visible()

    graficos_tab_link = page.locator('.fluxo-tab-link[data-fluxo-tab="graficos"]')
    expect(graficos_tab_link).to_be_visible()
    graficos_tab_link.click()

    # 5. Verify the new chart container is visible
    graficos_tab_content = page.locator("#fluxo-graficos-tab")
    expect(graficos_tab_content).to_be_visible()

    # Wait a moment for charts to potentially render, even if they are empty
    page.wait_for_timeout(1000)

    # 6. Take a screenshot
    page.screenshot(path="jules-scratch/verification/charts_verification.png")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        run_verification(page)
        browser.close()

if __name__ == "__main__":
    main()