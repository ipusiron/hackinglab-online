"""Render social-cards.html with an existing Playwright/Chromium installation.

This is an optional asset-authoring command, not part of the Pages build.
Run after refreshing the real tool screenshots in assets/discover.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    output = ROOT / "assets/social"
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        page.goto((ROOT / "scripts/social-cards.html").as_uri())
        page.evaluate("document.fonts.ready")
        page.locator("img").evaluate_all("images => Promise.all(images.map(image => image.decode()))")
        for target, name in [("#home-card", "hackinglab-online.png"), ("#discover-card", "discover.png")]:
            page.locator(target).screenshot(path=str(output / name))
            print(output / name)
        browser.close()


if __name__ == "__main__":
    main()
