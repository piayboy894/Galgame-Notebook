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
    page.get_by_role('menuitem', name='载入示例', exact=True).click()
    page.locator('#replace-discard').click()
    page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click()
    page.locator('[data-act="open-stage"][data-id="stage_a1_investigation"]').click()
    viewport = page.locator('.investigation-viewport')
    toolbar = page.get_by_role('group', name='调查工具')
    expect(page.get_by_role('textbox', name='阶段标题')).to_have_value('房间调查')
    expect(toolbar.locator('.stage-tab.active')).to_have_attribute('data-id', 'stage_a1_investigation')
    toolbar_boxes = [element.bounding_box() for element in [
        toolbar.locator('.stage-tab.active'),
        toolbar.get_by_role('button', name='新建卡片'),
        toolbar.get_by_role('button', name='适应全部卡片'),
    ]]
    centers = [box['y'] + box['height'] / 2 for box in toolbar_boxes]
    assert max(centers) - min(centers) <= 3
    bar = toolbar.bounding_box()
    assert bar['height'] <= 47 and abs(viewport.bounding_box()['y'] - bar['y'] - bar['height']) <= 1
    expect(page.locator('.investigation-card')).to_have_count(2)
    expect(page.locator('.investigation-writing')).to_have_count(0)
    page.locator('.inspect-open').nth(1).click()
    expect(page.locator('.investigation-card.is-selected .investigation-card-name strong')).to_have_text('房门')
    page.locator('.investigation-card.is-selected .investigation-writing [data-row-field="text"]').first.fill('调查阶段编辑仍然可用')
    page.locator('.inspect-open').first.click()
    expect(page.locator('.investigation-viewport .investigation-writing')).to_have_count(2)
    page.locator('.inspect-open').nth(1).click()
    door_line = page.locator('[data-row="line_demo_door"] textarea[data-row-field="text"]')
    door_line.click()
    field = door_line.bounding_box()
    page.mouse.move(field['x'] + 35, field['y'] + 10)
    page.mouse.wheel(0, -70)
    expect(page.get_by_role('button', name='重置缩放')).not_to_have_text('100%')
    door_line.fill('在放大的画布里直接编辑')
    page.locator('.investigation-card.is-selected').get_by_role('button', name='收起脚本').click()
    expect(page.locator('.investigation-writing')).to_have_count(1)
    page.get_by_role('button', name='收起全部脚本').click()
    expect(page.locator('.investigation-writing')).to_have_count(0)
    investigation = 'window.XuXian.snapshot().chapters[0].stages.find(s => s.id === "stage_a1_investigation")'
    world = page.locator('.investigation-world')
    fit = page.get_by_role('button', name='适应全部卡片')
    fit.click()
    original_camera = world.evaluate('element => element.style.transform')
    box = viewport.bounding_box()
    point = {'x': box['width'] - 100, 'y': 48}
    page.mouse.move(box['x'] + point['x'], box['y'] + point['y'])
    page.mouse.wheel(0, -160)
    expect(page.get_by_role('button', name='重置缩放')).not_to_have_text('100%')
    page.mouse.down()
    page.mouse.move(box['x'] + point['x'] - 60, box['y'] + point['y'] + 32, steps=5)
    page.mouse.up()
    assert world.evaluate('element => element.style.transform') != original_camera
    fit.click()

    viewport.dblclick(position=point)
    page.get_by_role('menuitem', name='新建物品', exact=True).click()
    page.locator('#inspect-name').fill('钥匙')
    page.locator('#inspect-reference').select_option('__new')
    page.locator('#inspect-reference-name').fill('旧书房')
    page.locator('#inspect-save').click()
    expect(page.locator('.investigation-card.is-selected')).to_contain_text('旧书房')
    key = page.evaluate(investigation + '.objects.at(-1)')
    card = page.locator(f'[data-investigation-card="{key["id"]}"] .inspect-open')
    bbox = card.bounding_box()
    x, y = bbox['x'] + 25, bbox['y'] + bbox['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x - 55, y + 20, steps=8)
    page.mouse.up()
    moved = page.evaluate(investigation + '.objects.at(-1).position')
    assert moved != key['position'], (moved, key)
    page.keyboard.press('Control+z')
    assert page.evaluate(investigation + '.objects.at(-1).position') == key['position']
    page.keyboard.press('Control+Shift+z')
    assert page.evaluate(investigation + '.objects.at(-1).position') == moved

    page.locator('.investigation-card.is-selected').get_by_role('button', name='默认交互设置').click()
    page.locator('#interaction-outcomes').fill('拿到钥匙')
    page.locator('#interaction-save').click()
    page.get_by_role('button', name='新建卡片').click()
    page.get_by_role('menuitem', name='新建人物', exact=True).click()
    page.locator('#inspect-reference').select_option('__new')
    page.locator('#inspect-reference-name').fill('房间守卫')
    page.locator('#inspect-save').click()
    page.locator('.investigation-card.is-selected').get_by_role('button', name='默认交互设置').click()
    page.locator('#interaction-fallback').uncheck()
    page.locator('#interaction-save').click()

    for timing, name, conditions, dialogue in [
        ('exact', '第一次盘问', '拿到钥匙\n调查过信封', '你终于找到了钥匙。'),
        ('from', '再次盘问', '拿到钥匙', '我已经没有别的线索了。'),
    ]:
        page.locator('.investigation-card.is-selected').get_by_role('button', name='交互规则', exact=True).click()
        page.locator('#interaction-name').fill(name)
        page.locator('#interaction-timing').select_option(timing)
        if timing == 'from':
            page.locator('#interaction-attempt').fill('2')
        page.locator('#interaction-conditions').fill(conditions)
        page.locator('#interaction-save').click()
        page.locator('.investigation-card.is-selected .investigation-writing [data-act="add-row"]').click()
        page.locator('.investigation-card.is-selected .investigation-writing textarea[data-row-field="text"]').fill(dialogue)

    page.get_by_role('button', name='演练', exact=True).click()
    result = page.locator('.investigation-rehearsal-result')
    guard = page.get_by_role('dialog', name='演练调查').get_by_role('button', name='房间守卫', exact=False)
    guard.click()
    expect(result).to_contain_text('交互次数保持为 0')
    page.get_by_role('button', name='钥匙 已交互 0 次').click()
    expect(result).to_contain_text('拿到钥匙')
    guard.click()
    expect(result).to_contain_text('交互次数保持为 0')
    page.get_by_role('button', name='信封 已交互 0 次').click()
    guard.click()
    expect(result).to_contain_text('你终于找到了钥匙。')
    guard.click()
    expect(result).to_contain_text('我已经没有别的线索了。')
    page.get_by_role('button', name='重置演练').click()
    expect(guard).to_contain_text('已交互 0 次')
    page.get_by_role('button', name='完成', exact=True).click()

    page.keyboard.press('Control+k')
    page.locator('#search-input').fill('我已经没有别的线索了')
    page.get_by_role('button', name='我已经没有别的线索了', exact=False).click()
    expect(page.locator('.investigation-card.is-selected .investigation-script-select option:checked')).to_contain_text('再次盘问')
    project = page.evaluate('window.XuXian.snapshot()')
    page.locator('#menu-btn').click()
    with page.expect_download() as exported:
        page.get_by_role('menuitem', name='下载源文件副本', exact=True).click()
    page.locator('#file-input').set_input_files(exported.value.path())
    if page.locator('#replace-discard').is_visible():
        page.locator('#replace-discard').click()
    page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click()
    page.locator('[data-act="open-stage"][data-id="stage_a1_investigation"]').click()
    expect(page.locator('.investigation-card')).to_have_count(4)
    assert page.evaluate(investigation + '.objects.at(-2).position') == moved
    assert page.evaluate('window.XuXian.snapshot().locations') == project['locations']
    guard_item = page.evaluate(investigation + '.objects.at(-1)')
    assert guard_item['characterId']
    assert len(guard_item['interactions']) == 2
    page.locator(f'[data-investigation-card="{guard_item["id"]}"] .inspect-open').click()
    page.locator('.investigation-card.is-selected .investigation-script-select').select_option(guard_item['interactions'][0]['id'])
    screenshots = Path(os.environ.get('SCREENSHOT_DIR', ROOT / 'work/test-results'))
    screenshots.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(screenshots / 'editor-desktop-preview.png'), full_page=True)
    assert failures == [], failures
    print('PASS: script editing, investigation canvas, locations, repeated and conditional dialogue, rehearsal, and JSON round trip')
    browser.close()
