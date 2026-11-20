"""Exercise investigation card selection, clipboard transfer and NPC persistence."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'stage_a1_investigation'
TARGET = 'stage_investigation_copy'
fixture = json.loads((ROOT / 'examples/示例剧本.story.json').read_text(encoding='utf-8'))
fixture['chapters'][0]['stages'].append({
    'id': TARGET, 'title': '大厅调查', 'kind': 'investigation', 'rows': [], 'objects': [],
})

with sync_playwright() as playwright:
    chromium = os.environ.get('CHROMIUM_PATH') or (
        '/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None
    )
    browser = playwright.chromium.launch(executable_path=chromium, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1360, 'height': 960})
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:1420'))

    def open_project(buffer, name):
        page.locator('#file-input').set_input_files({
            'name': name, 'mimeType': 'application/json', 'buffer': buffer,
        })
        if page.locator('#replace-discard').is_visible():
            page.locator('#replace-discard').click()
        page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click()

    def open_stage(stage_id):
        page.locator(f'[data-act="open-stage"][data-id="{stage_id}"]').click()

    def project():
        return page.evaluate('window.XuXian.snapshot()')

    def cards(stage_id):
        return next(s for s in project()['chapters'][0]['stages'] if s['id'] == stage_id)['objects']

    def card(card_id):
        return page.locator(f'[data-investigation-card="{card_id}"]')

    def new_person():
        page.get_by_role('button', name='新建卡片').click()
        page.get_by_role('menuitem', name='新建人物', exact=True).click()

    open_project(json.dumps(fixture).encode(), 'investigation.story.json')
    open_stage(SOURCE)
    expect(page.locator('.investigation-hint')).to_have_count(0)
    new_person()
    page.locator('#inspect-reference').select_option('char_lin')
    page.locator('#inspect-location').select_option('__new')
    page.locator('#inspect-location-name').fill('大厅服务台')
    page.locator('#inspect-save').click()
    linked = cards(SOURCE)[-1]
    assert linked['characterId'] == 'char_lin'
    assert linked['locationId'] == project()['locations'][0]['id']
    expect(card(linked['id'])).to_contain_text('大厅服务台')

    new_person()
    page.locator('#inspect-reference').select_option('__temporary')
    page.locator('#inspect-reference-name').fill('值班员')
    page.locator('#inspect-location').select_option(linked['locationId'])
    page.locator('#inspect-save').click()
    npc = cards(SOURCE)[-1]
    card(npc['id']).get_by_role('button', name='交互规则', exact=True).click()
    page.locator('#interaction-name').fill('核对信封')
    page.locator('#interaction-conditions').fill('调查过信封')
    page.locator('#interaction-save').click()
    card(npc['id']).locator('[data-act="add-row"]').click()
    card(npc['id']).locator('textarea[data-row-field="text"]').fill('请在这里登记。')
    expect(card(npc['id']).get_by_role('combobox', name='说话人')).to_have_value(npc['id'])
    assert len(project()['characters']) == len(fixture['characters'])
    page.get_by_role('button', name='收起全部脚本').click()
    page.get_by_role('button', name='缩小画布').click()
    source = cards(SOURCE)
    heads = [card(item['id']).locator('.investigation-card-head').bounding_box() for item in source]
    left, top = min(r['x'] for r in heads) - 8, min(r['y'] for r in heads) - 8
    right = max(r['x'] + r['width'] for r in heads) + 8
    bottom = max(r['y'] + r['height'] for r in heads) + 8
    page.mouse.move(right, bottom)
    page.mouse.down(button='right')
    page.mouse.move(left, top, steps=10)
    expect(page.locator('.investigation-selection-box')).to_be_visible()
    page.mouse.up(button='right')
    expect(page.locator('.investigation-selection-box')).to_be_hidden()
    expect(page.locator('.is-card-picked')).to_have_count(len(source))

    page.keyboard.press('Control+c')
    expect(page.locator('#toast')).to_contain_text('已复制 4 张卡片')
    open_stage(TARGET)
    page.keyboard.press('Control+v')
    copied = cards(TARGET)
    assert len(copied) == len(source)
    assert {item['id'] for item in source}.isdisjoint(item['id'] for item in copied)
    offset = {axis: copied[0]['position'][axis] - source[0]['position'][axis] for axis in ('x', 'y')}
    for previous, duplicate in zip(source, copied):
        assert {axis: previous['position'][axis] + offset[axis] for axis in offset} == duplicate['position']
    new_npc = copied[-1]
    assert new_npc['temporaryCharacter'] and new_npc['locationId'] == linked['locationId']
    rule = new_npc['interactions'][0]
    assert rule['id'] != source[-1]['interactions'][0]['id']
    assert rule['conditions'][0]['targetId'] == copied[0]['id']
    assert rule['rows'][0]['speakerId'] == new_npc['id']
    assert rule['rows'][0]['text'] == '请在这里登记。'
    assert rule['rows'][0]['id'] != source[-1]['interactions'][0]['rows'][0]['id']

    page.keyboard.press('Control+z')
    assert not cards(TARGET)
    page.keyboard.press('Control+Shift+z')
    assert cards(TARGET) == copied
    # The card menu provides the same typed clipboard for touch devices.
    page.locator('.investigation-viewport').click(position={'x': 10, 'y': 10})
    card(new_npc['id']).locator('[data-act="inspect-menu"]').click()
    page.get_by_role('menuitem', name='复制卡片', exact=True).click()
    open_stage(SOURCE)
    page.get_by_role('button', name='新建卡片').click()
    page.get_by_role('menuitem', name='粘贴卡片', exact=True).click()
    expect(page.locator('#toast')).to_contain_text('请重设引用了其他阶段卡片的条件')
    assert cards(SOURCE)[-1]['interactions'][0]['conditions'][0]['targetId'] == copied[0]['id']

    page.locator('#menu-btn').click()
    page.get_by_role('menuitem', name='使用说明', exact=True).click()
    expect(page.get_by_role('dialog', name='使用说明')).to_contain_text('按住鼠标右键拖动')
    page.keyboard.press('Escape')
    page.locator('#menu-btn').click()
    with page.expect_download() as exported:
        page.get_by_role('menuitem', name='下载源文件副本', exact=True).click()
    open_project(exported.value.path().read_bytes(), 'investigation-copy.story.json')
    open_stage(TARGET)
    assert cards(TARGET) == copied
    expect(card(new_npc['id'])).to_contain_text('临时 NPC')
    expect(card(new_npc['id'])).to_contain_text('大厅服务台')
    assert not errors, errors
    browser.close()
    print('PASS: investigation selection, stage clipboard, NPC and location, rule references, undo and save/reopen')
