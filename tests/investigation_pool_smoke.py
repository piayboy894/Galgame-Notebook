"""Write a later investigation by reusing cards and overriding only changed dialogue."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'stage_pool_base'
NEXT = 'stage_pool_next'
LEGACY = 'stage_pool_legacy'
fixture = json.loads((ROOT / 'examples/示例剧本.story.json').read_text(encoding='utf-8'))


def card_data(id, name, x, lines, **extra):
    return {'id': id, 'name': name, 'position': {'x': x, 'y': 0},
            'rows': [{'id': f'{id}_line_{i}', 'text': text} for i, text in enumerate(lines)], **extra}


def stage(id, title, objects):
    return {'id': id, 'title': title, 'kind': 'investigation', 'rows': [], 'objects': objects}


fixture['chapters'][0]['stages'].append(stage(BASE, '码头调查', [
    card_data('pool_boat', '渡船', 0, ['船头挂着灯。', '船上没人。']),
    card_data('pool_npc', '守夜人', 240, ['今晚有雾。'], temporaryCharacter=True, interactions=[
        {'id': 'pool_rule', 'name': '看过渡船', 'timing': 'any',
         'conditions': [{'type':'investigated','targetId':'pool_boat','expected':True}],
         'rows': [{'id':'pool_reply','speakerId':'pool_npc','text':'我见过那艘渡船。'}]}]),
]))
fixture['chapters'][1]['stages'].append(stage(NEXT, '返访码头', []))
fixture['chapters'][2]['stages'].append(stage(LEGACY, '旧版码头', [
    card_data('old_boat', '渡船', 0, ['船头挂着灯。', '船上有人。']),
    card_data('old_npc', '守夜人', 240, ['今晚有雾。'], temporaryCharacter=True),
]))

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1360, 'height': 960})
    page.set_default_timeout(9000)
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:1420'))

    def snapshot():
        return page.evaluate('window.XuXian.snapshot()')

    def stage_data(id):
        return next(s for c in snapshot()['chapters'] for s in c['stages'] if s['id'] == id)

    def open_phase(id):
        chapter = next(c for c in snapshot()['chapters'] if any(s['id'] == id for s in c['stages']))
        page.locator('#brand').click()
        page.locator(f'[data-act="open-chapter"][data-id="{chapter["id"]}"]').click()
        page.locator(f'[data-act="open-stage"][data-id="{id}"]').click()

    def card(id):
        return page.locator(f'[data-investigation-card="{id}"]')

    def line_field(id, index):
        return card(id).locator('textarea.dialogue-cell').nth(index)

    def open_card(id):
        card(id).locator('.inspect-open').click()

    def top_menu(item):
        page.locator('#menu-btn').click()
        page.get_by_role('menuitem', name=item, exact=True).click()

    page.locator('#file-input').set_input_files({
        'name': 'pool.story.json', 'mimeType': 'application/json', 'buffer': json.dumps(fixture).encode()
    })
    open_phase(NEXT)
    base, base_npc = stage_data(BASE)['objects']
    assert base['poolId'] != stage_data(LEGACY)['objects'][0]['poolId']
    page.get_by_role('button', name='调查卡池', exact=True).click()
    page.get_by_role('button', name='设置默认来源').click()
    page.locator('#investigation-source').select_option(BASE)
    page.locator('#investigation-inherit-save').click()

    page.get_by_role('button', name='调查卡池', exact=True).click()
    terms = page.locator('#investigation-pool-search')
    terms.fill('渡船')
    dialog = page.get_by_role('dialog', name='调查卡池')
    dialog.locator(f'input[value="{base["poolId"]}"]').check()
    terms.fill('守夜人')
    dialog.locator(f'input[value="{base_npc["poolId"]}"]').check()
    page.locator('#investigation-pool-add').click()
    target, target_npc = stage_data(NEXT)['objects']
    assert target['poolId'] == base['poolId'] and target['id'] != base['id']
    assert target_npc['interactions'][0]['conditions'][0]['targetId'] == target['id']
    assert target_npc['interactions'][0]['rows'][0]['speakerId'] == target_npc['id']
    open_card(target['id'])
    expect(card(target['id']).locator('.investigation-script-source')).to_contain_text('码头调查')
    expect(line_field(target['id'], 1)).to_have_value('船上没人。')
    line_field(target['id'], 1).fill('船上有人。')
    open_phase(BASE)
    open_card(base['id'])
    line_field(base['id'], 0).fill('船头挂着红灯。')
    line_field(base['id'], 1).fill('船上有人。')
    line_field(base['id'], 1).fill('船上很安静。')
    card(base['id']).locator('[data-act="add-row"]').click()
    line_field(base['id'], 2).fill('关上船门。')

    open_phase(NEXT)
    open_card(target['id'])
    expect(line_field(target['id'], 0)).to_have_value('船头挂着红灯。')
    expect(line_field(target['id'], 1)).to_have_value('船上有人。')
    expect(line_field(target['id'], 2)).to_have_value('关上船门。')
    card(target['id']).locator('[data-act="row-menu"]').nth(1).click()
    page.get_by_role('menuitem', name='恢复此行的继承内容').click()
    expect(line_field(target['id'], 1)).to_have_value('船上很安静。')

    open_phase(LEGACY)
    heads = [card(id).locator('.investigation-card-head').bounding_box() for id in ('old_boat','old_npc')]
    left = min(box['x'] for box in heads) - 8
    top = min(box['y'] for box in heads) - 8
    right = max(box['x'] + box['width'] for box in heads) + 8
    bottom = max(box['y'] + box['height'] for box in heads) + 8
    page.mouse.move(left, top)
    page.mouse.down(button='right')
    page.mouse.move(right, bottom, steps=8)
    page.mouse.up(button='right')
    expect(page.locator('.is-card-picked')).to_have_count(2)
    card('old_boat').locator('.inspect-open').click(button='right')
    page.get_by_role('menuitem', name='批量继承对白…').click()
    page.locator('#investigation-source').select_option(BASE)
    expect(page.locator('#investigation-inherit-save')).to_be_disabled()
    page.locator('#investigation-match-name').check()
    expect(page.locator('#investigation-inheritance-preview')).to_contain_text('2 / 2')
    page.locator('#investigation-inherit-save').click()
    linked = stage_data(LEGACY)['objects']
    assert [item['poolId'] for item in linked] == [base['poolId'], base_npc['poolId']]
    assert linked[0]['rows'][1]['text'] == '船上有人。'
    assert linked[0]['rows'][2]['text'] == '关上船门。'
    assert linked[1]['interactions'][0]['conditions'][0]['targetId'] == linked[0]['id']

    page.locator('#menu-btn').click()
    with page.expect_download() as exported:
        page.get_by_role('menuitem', name='下载源文件副本', exact=True).click()
    page.locator('#file-input').set_input_files(exported.value.path())
    if page.locator('#replace-discard').is_visible():
        page.locator('#replace-discard').click()
    expect(page.locator('.chapter-card').first).to_be_visible()
    assert stage_data(LEGACY)['objects'] == linked
    assert stage_data(NEXT)['investigationSourceId'] == BASE
    assert not errors, errors
    print('PASS: shared investigation pool, phase defaults, live dialogue overrides, batch adoption and reopen')
