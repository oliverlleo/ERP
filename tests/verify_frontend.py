import re
from playwright.sync_api import Page, expect

def test_finance_page_visual_verification(page: Page):
    """
    This test performs a visual verification of the new Finance module.
    1.  It logs into the application.
    2.  It navigates to the "Contas a Pagar" page to verify the main screen.
    3.  It takes a screenshot of the "Contas a Pagar" page.
    4.  It opens the "Lançar Nova Despesa" modal.
    5.  It takes a screenshot of the modal to verify its layout and fields.
    """
    # Go to the app
    page.goto("http://localhost:8000")

    # 1. Log in using the test user bypass
    page.fill("#login-email", "test.user@email.com")
    page.fill("#login-password", "password123")
    page.click("button[type='submit']")

    # Expect the main page to be visible
    expect(page.locator("#main-page")).to_be_visible(timeout=10000)

    # 2. Navigate to Contas a Pagar page
    page.click("#financeiro-nav-link")
    page.click("a.nav-link[data-target='contas-a-pagar-page']")
    expect(page.locator("#contas-a-pagar-page")).to_be_visible()
    expect(page.locator("#contas-a-pagar-page h1")).to_contain_text("Módulo Financeiro")

    # 3. Take a screenshot of the main finance page
    page.screenshot(path="tests/screenshots/finance_page_verify.png")

    # 4. Open the 'Lançar Nova Despesa' modal
    page.click("#lancar-despesa-btn")
    expect(page.locator("#despesa-modal")).to_be_visible()

    # 5. Take a screenshot of the modal
    page.screenshot(path="tests/screenshots/finance_modal_verify.png")

    print("Frontend verification screenshots captured.")