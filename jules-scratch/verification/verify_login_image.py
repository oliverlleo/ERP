import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Get the absolute path to the index.html file
        file_path = os.path.abspath('index.html')

        await page.goto(f'file://{file_path}')

        # Wait for the login page to be visible
        await page.wait_for_selector('#login-page', state='visible')

        # Take a screenshot of the login page
        await page.screenshot(path='jules-scratch/verification/login_page.png')

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())