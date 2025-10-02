import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # Set a large viewport to ensure the image div is visible (triggers lg:block)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})

        # Get the absolute path to the index.html file
        file_path = os.path.abspath('index.html')

        await page.goto(f'file://{file_path}')

        # Wait for the login page to be visible
        await page.wait_for_selector('#login-page', state='visible')

        # Take a screenshot of the login page
        await page.screenshot(path='jules-scratch/verification/login_page_correct_viewport.png')

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())