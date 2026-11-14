"""Regression smoke test in isolated Chromium, without a user's browser session."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import os

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1360, 'height': 900})
    failures = []
    page.on('pageerror', lambda error: failures.append(str(error)))
    page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:1420'))
    expect(page.locator('#library-update')).to_be_visible()
    page.locator('#library-update').click()
    expect(page.get_by_role('dialog', name='软件更新')).to_be_visible()
    expect(page.locator('#update-status')).to_contain_text('浏览器预览模式')
    page.locator('#update-close').click()
    page.locator('#file-input').set_input_files(str(ROOT / 'examples/示例剧本.story.json'))
    expect(page.locator('.chapter-card')).to_have_count(9)
    page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click()
    page.locator('[data-act="open-stage"][data-id="stage_a1_1"]').press('Enter')
    page.locator('.script-row textarea[data-row-field="text"]').first.fill('桌面架构迁移后的测试对白\n第二行')
    page.locator('[data-act="add-effect"]').last.click()
    expect(page.locator('.effect-row')).to_have_count(1)
    before = page.evaluate('window.XuXian.snapshot().chapters[0].stages[0].rows.length')
    page.keyboard.press('Control+z')
    assert page.evaluate('window.XuXian.snapshot().chapters[0].stages[0].rows.length') == before - 1
    page.keyboard.press('Control+Shift+z')
    assert page.evaluate('window.XuXian.snapshot().chapters[0].stages[0].rows.length') == before
    page.locator('#menu-btn').click()
    page.get_by_role('button', name='载入示例', exact=True).click()
    page.locator('#replace-discard').click()
    page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click()
    page.locator('[data-act="open-stage"][data-id="stage_a1_investigation"]').click()
    expect(page.locator('.inspect-card')).to_have_count(2)
    page.locator('.inspect-open').nth(1).click()
    expect(page.locator('.inspect-card.is-open .inspect-name')).to_have_text('房门')
    page.locator('.inspect-card.is-open [data-row-field="text"]').first.fill('调查阶段编辑仍然可用')
    screenshots = Path(os.environ.get('SCREENSHOT_DIR', ROOT / 'work/test-results'))
    screenshots.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(screenshots / 'editor-desktop-preview.png'), full_page=True)
    assert failures == [], failures
    print('PASS: import, routes, dialogue, effect rows, undo/redo, investigation, update entry, no JS errors')
    browser.close()
