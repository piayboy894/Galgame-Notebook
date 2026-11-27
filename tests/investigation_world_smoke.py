"""Follow a continuous investigation from authoring through rehearsal and AI export."""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
project = json.loads((root / 'examples/示例剧本.story.json').read_text(encoding='utf-8'))
before, after = project['chapters'][:2]
project['chapters'] = [before, after]
project['version'] = 6
after.update(routeId=before['routeId'], title='咖啡馆', y=before['y'] + 200)
before['title'] = '序章'
for chapter in (before, after):
    chapter['unlock']['rules'] = []
project['investigationPool'] = [{'id': 'pool_extra', 'name': '未出场的NPC', 'temporaryCharacter': True}]
project['flags'] = [{'id': 'flag_letter_read', 'name': '读过来信'}]
after['stages'] = [{'id': 'cafe_story', 'title': '前往咖啡馆', 'kind': 'story'}]
before['stages'] = [{
    'id': 'first', 'title': '共通线自由活动', 'kind': 'investigation', 'objects': [
        {'id': 'letter', 'name': '信封', 'position': {'x': 15, 'y': 6}, 'rows': [{'id': 'letter_line', 'text': '信封静静地躺在桌上。'}],
         'interactions': [{'id': 'first_letter', 'name': '第一次读信', 'timing': 'exact', 'attempt': 1,
                           'outcomes': ['flag_letter_read'], 'rows': [{'id': 'first_line', 'text': '你第一次打开来信。'}]}]},
        {'id': 'passerby', 'name': '路人', 'temporaryCharacter': True, 'position': {'x': 3, 'y': 7}},
        {'id': 'barista', 'name': '店员', 'temporaryCharacter': True, 'position': {'x': 447, 'y': 14},
         'interactions': [{'id': 'ask_letter', 'name': '询问来信', 'conditions': [
             {'type': 'investigated', 'targetId': 'letter'},
             {'type': 'investigated', 'targetId': 'passerby'},
             {'type': 'flag', 'targetId': 'flag_letter_read'},
         ], 'rows': [{'id': 'reply', 'speakerId': 'barista', 'text': '那封信是我寄来的。'}]}]},
    ],
}]

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or (
        '/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    errors = []

    def open_editor(touch=False):
        editor = browser.new_page(has_touch=touch, viewport={'width': 1360, 'height': 960})
        editor.set_default_timeout(8000)
        editor.on('pageerror', lambda error: errors.append(str(error)))
        editor.goto(os.environ.get('APP_URL', 'http://127.0.0.1:1420'))
        expect(editor.locator('#library-update')).to_be_visible()
        return editor

    page = open_editor()

    def load(project):
        page.locator('#file-input').set_input_files({
            'name': 'world.story.json', 'mimeType': 'application/json', 'buffer': json.dumps(project).encode(),
        })
        expect(page.locator('.chapter-card')).to_have_count(len(project['chapters']))

    def snapshot():
        return page.evaluate('window.XuXian.snapshot()')

    def all_stages():
        return [stage for chapter in snapshot()['chapters'] for stage in chapter['stages']]

    def stage_data(title):
        return next(stage for stage in all_stages() if stage['title'] == title)

    def open_chapter(chapter):
        page.locator('#brand').click()
        page.locator(f'[data-act="open-chapter"][data-id="{chapter["id"]}"]').click()

    def open_stage(chapter, stage_id):
        open_chapter(chapter)
        page.locator(f'[data-act="open-stage"][data-id="{stage_id}"]').click()

    def new_investigation(title, source_id):
        page.locator('[data-act="add-stage"]').first.click()
        page.locator('#st-title').fill(title)
        page.locator('#st-kind').select_option('investigation')
        expect(page.locator('#st-world-source')).to_have_value(source_id)
        page.locator('#st-save').click()
        return stage_data(title)

    def card(item_id):
        return page.locator(f'[data-investigation-card="{item_id}"]')

    def menu_card(item_id, command):
        card(item_id).locator('[data-act="inspect-menu"]').click()
        page.get_by_role('menuitem', name=command, exact=True).click()

    def lines(item_id):
        return card(item_id).locator('textarea.dialogue-cell')

    def dialogue(item_id):
        card(item_id).locator('.inspect-open').click()
        if card(item_id).locator('.investigation-script-preview').is_visible():
            card(item_id).locator('.investigation-writing [data-act="inspect-modify"]').click()
        return lines(item_id).first

    def drag_card(item_id, dx, dy, blocked=None):
        header = card(item_id).locator('.inspect-open').bounding_box()
        x, y = header['x'] + 25, header['y'] + header['height'] / 2
        scale = card(item_id).evaluate('(card) => card.getBoundingClientRect().width / card.offsetWidth')
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + dx * scale, y + dy * scale, steps=8)
        drop = page.locator('.investigation-drop-cell')
        if blocked is None:
            expect(drop).to_be_hidden()
        else:
            expect(drop).to_be_visible()
            assert ('is-blocked' in drop.get_attribute('class')) == blocked
        page.mouse.up()
        expect(drop).to_be_hidden()

    def card_data(title, item_id):
        return next(item for item in stage_data(title)['objects'] if item['id'] == item_id)

    def visit(item_id):
        return page.locator(f'[data-investigation-visit="{item_id}"]')

    def export_markdown(scoped=False):
        page.locator('#menu-btn').click()
        if scoped:
            page.get_by_role('menuitem', name='按范围导出可读剧本…', exact=True).click()
            page.locator('#markdown-scope').select_option('chapter:' + after['id'])
            export = page.locator('#markdown-scope-export')
        else:
            export = page.get_by_role('menuitem', name='导出可读剧本', exact=True)
        with page.expect_download() as download:
            export.click()
        return download.value.path().read_text(encoding='utf-8')

    load(project)
    assert 'worldSourceId' not in stage_data('共通线自由活动')
    root_positions = [item['position'] for item in stage_data('共通线自由活动')['objects']]
    assert root_positions == [{'x': 0, 'y': 0}, {'x': 224, 'y': 0}, {'x': 448, 'y': 0}]
    open_chapter(after)
    opening = new_investigation('开端', 'first')
    letter, passerby, barista = [item['id'] for item in opening['objects']]
    assert opening['worldSourceId'] == 'first'
    expect(page.locator('.investigation-card.is-carried')).to_have_count(3)
    expect(page.locator('.investigation-card')).to_have_count(3)
    page.locator('#brand').hover()
    assert page.locator('.investigation-card.is-carried .investigation-card-head').first.evaluate(
        '(head) => getComputedStyle(head).opacity') == '0.66'
    assert opening['objects'][2]['interactions'][0]['conditions'][0]['targetId'] == letter
    drag_card(letter, 0, 100)
    assert card_data('开端', letter)['position'] == root_positions[0]
    card(letter).locator('.inspect-open').click()
    expect(card(letter).locator('.investigation-script-preview')).to_contain_text('信封静静地躺在桌上。')
    expect(lines(letter)).to_have_count(0)
    page.get_by_role('button', name='收起全部脚本').click()
    card(passerby).locator('.inspect-open').hover()
    card(passerby).locator('.investigation-card-quick [data-act="inspect-leave"]').click()
    expect(card(passerby)).to_have_count(0)

    continuation = new_investigation('稍后', opening['id'])
    assert [item['name'] for item in continuation['objects']] == ['信封', '店员']
    open_stage(after, opening['id'])
    page.get_by_role('button', name='世界状态').click()
    page.locator(f'[data-world-restore="{passerby}"]').check()
    page.locator('#investigation-world-save').click()
    expect(card(passerby)).to_be_visible()
    assert '路人' in [item['name'] for item in stage_data('稍后')['objects']
                     if not item.get('world', {}).get('unavailable')]
    menu_card(passerby, '本阶段离场')
    line = dialogue(letter)
    line.fill('现在把信封收回口袋。')

    open_stage(before, 'first')
    dialogue('letter').fill('原来信封是蓝色的。')
    expect(lines('letter').first).to_have_value('原来信封是蓝色的。')
    open_stage(after, opening['id'])
    expect(lines(letter).first).to_have_value('现在把信封收回口袋。')
    page.get_by_role('button', name='收起全部脚本').click()
    before_layout = export_markdown(scoped=True)
    drag_card(letter, 448, 0, blocked=True)
    assert card_data('开端', letter)['position'] == root_positions[0]
    drag_card(letter, 8, 100, blocked=False)
    assert card_data('开端', letter)['position'] == {'x': 0, 'y': 100}
    assert export_markdown(scoped=True) == before_layout
    page.keyboard.press('Control+z')
    assert card_data('开端', letter)['position'] == root_positions[0]
    page.keyboard.press('Control+Shift+z')
    assert card_data('开端', letter)['position'] == {'x': 0, 'y': 100}
    # Playing from the earlier phase preserves flags and attempts when opening the next phase.
    page.get_by_role('button', name='演练', exact=True).click()
    picker = page.locator('#investigation-rehearsal-stage')
    picker.select_option('first')
    visit('letter').click()
    result = page.locator('.investigation-rehearsal-result')
    expect(result).to_contain_text('你第一次打开来信。')
    visit('passerby').click()
    picker.select_option(opening['id'])
    expect(visit(letter)).to_contain_text('已交互 1 次')
    expect(visit(passerby)).to_have_count(0)
    expect(result).to_contain_text('已进入下一调查阶段')
    visit(barista).click()
    expect(result).to_contain_text('那封信是我寄来的。')
    visit(letter).click()
    expect(result).to_contain_text('第 2 次')
    expect(result).to_contain_text('现在把信封收回口袋。')
    page.get_by_role('button', name='完成', exact=True).click()

    full = export_markdown()
    single = export_markdown(scoped=True)
    for text in (full, single):
        current = text.split('#### 开端 [调查]', 1)[1].split('#### 稍后', 1)[0]
        assert '延续「调查线 / 序章 / 共通线自由活动」' in current
        assert '本阶段在场：信封、店员' in current and '本阶段离场：路人' in current
        assert '现在把信封收回口袋。' in current and '未出场的NPC' not in text
    assert full.count('那封信是我寄来的。') == 1
    assert '沿用来源的地点和交互：店员' in full
    assert '那封信是我寄来的。' in single and '调查过信封' in single and '调查过路人' in single
    assert '原来信封是蓝色的。' not in single
    menu_card(letter, '本阶段从第 1 次调查开始')
    assert '本阶段重置调查次数：信封' in export_markdown(scoped=True)
    page.get_by_role('button', name='演练', exact=True).click()
    picker.select_option('first')
    visit('letter').click()
    picker.select_option(opening['id'])
    expect(visit(letter)).to_contain_text('已交互 0 次')
    page.get_by_role('button', name='完成', exact=True).click()

    saved = snapshot()
    assert saved['version'] == 7
    page.close()
    # A v7 position override on an otherwise inherited card stays pale and locked.
    persisted_opening = next(stage for chapter in saved['chapters'] for stage in chapter['stages'] if stage['id'] == opening['id'])
    persisted_barista = next(item for item in persisted_opening['objects'] if item['id'] == barista)
    persisted_barista['position'] = {'x': 499, 'y': 106}
    persisted_barista['world']['fields'] = ['position']
    page = open_editor(touch=True)
    load(saved)
    open_stage(after, opening['id'])
    expect(card(passerby)).to_have_count(0)
    assert card_data('开端', letter)['rows'][0]['text'] == '现在把信封收回口袋。'
    expect(card(barista)).to_have_class(re.compile(r'\bis-carried\b'))
    assert card_data('开端', barista)['position'] == {'x': 448, 'y': 100}
    card(barista).locator('.investigation-card-quick [data-act="inspect-modify"]').tap()
    expect(card(barista).locator('.investigation-writing')).to_be_visible()
    expect(card(barista)).to_contain_text('延续')
    assert not errors, errors
    print(f'PASS: inherited preview, grid snapping, collision, local overrides, visit history, full export {len(full.encode())} B, scoped export {len(single.encode())} B')
