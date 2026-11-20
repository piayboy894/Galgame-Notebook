"""Exercise encyclopedia editing, selected-text links, reading and save/reopen."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'examples' / '示例剧本.story.json'

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or (
        '/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None
    )
    browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1360, 'height': 960})
    failures = []
    page.on('pageerror', lambda error: failures.append(str(error)))
    page.set_default_timeout(8000)
    page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:1420'))

    def top_menu(label):
        page.locator('#menu-btn').click()
        page.get_by_role('menuitem', name=label, exact=True).click()

    def open_stage(stage_id='stage_a1_1'):
        page.locator('#brand').click()
        page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click()
        page.locator(f'[data-act="open-stage"][data-id="{stage_id}"]').click()

    def mark(field, start, end, use_row_menu=False):
        field.focus()
        field.evaluate('(field, range) => field.setSelectionRange(...range)', [start, end])
        if use_row_menu:
            field.locator('xpath=ancestor::*[@data-row or @data-branch-row][1]').get_by_role(
                'button', name='行操作',
            ).click()
        else:
            field.click(button='right', position={'x': 17, 'y': 13})
        page.get_by_role('menuitem', name='转换成词条', exact=True).click()

    def snapshot():
        return page.evaluate('window.XuXian.snapshot()')

    page.locator('#file-input').set_input_files(str(FIXTURE))
    top_menu('百科')
    page.get_by_role('button', name='新建词条', exact=True).click()
    page.locator('#encyclopedia-title').fill('潮汐协议')
    page.locator('#encyclopedia-body').fill('北港和南港的通航约定。')
    page.locator('#encyclopedia-save').click()
    entry = snapshot()['encyclopedia'][0]
    page.get_by_role('searchbox', name='搜索词条').fill('南港')
    expect(page.get_by_role('button', name='潮汐协议 北港和南港的通航约定。')).to_be_visible()

    open_stage()
    field = page.locator('[data-row="line_1"] textarea.dialogue-cell')
    field.fill('潮汐协议，潮汐协议。')
    # Mark only the second occurrence, through the context menu on the selected text.
    field.evaluate('e => e.setSelectionRange(5, 9)')
    field.click(button='right', position={'x': 102, 'y': 13})
    page.get_by_role('menuitem', name='转换成词条', exact=True).click()
    expect(page.locator('#encyclopedia-target')).to_have_value(entry['id'])
    page.locator('#encyclopedia-link').click()
    expect(field).to_have_value('潮汐协议，潮汐协议。')
    expect(page.locator('[data-row="line_1"] .encyclopedia-chip')).to_have_count(1)
    page.locator('[data-act="read-stage"]').click()
    terms = page.locator('.encyclopedia-term')
    expect(terms).to_have_count(1)
    expect(terms).to_have_text('潮汐协议')
    expect(page.locator('.encyclopedia-note')).to_have_count(0)
    terms.click()
    expect(page.locator('.encyclopedia-note')).to_contain_text('北港和南港的通航约定。')
    terms.click()
    expect(page.locator('.encyclopedia-note')).to_have_count(0)
    page.keyboard.press('Escape')

    field.focus()
    field.press('Home')
    field.press('ArrowRight')
    page.keyboard.insert_text('新')
    link = snapshot()['chapters'][0]['stages'][0]['rows'][0]['encyclopediaLinks'][0]
    assert (link['start'], link['end'], link['entryId']) == (6, 10, entry['id'])

    # Branch dialogues share the selection action and can create a definition inline.
    branch = page.locator('[data-branch-row="line_local_a1"] textarea.dialogue-cell')
    branch.fill('星塔。')
    mark(branch, 0, 2, use_row_menu=True)
    expect(page.locator('#encyclopedia-title')).to_have_value('星塔')
    page.locator('#encyclopedia-body').fill('旧城的导航塔。')
    page.locator('#encyclopedia-link').click()
    assert len(snapshot()['encyclopedia']) == 2

    page.locator('[data-row="line_1"] .row-select').click()
    page.keyboard.press('Control+c')
    page.locator('[data-row="line_2"] .row-select').click()
    page.keyboard.press('Control+v')
    assert snapshot()['chapters'][0]['stages'][0]['rows'][2]['encyclopediaLinks'][0] == link

    # The link range follows the script's existing line-length setting.
    top_menu('项目设置')
    page.locator('#dialogue-line-limit').fill('4')
    page.locator('#dialogue-setting-save').click()
    row = snapshot()['chapters'][0]['stages'][0]['rows'][0]
    span = row['encyclopediaLinks'][0]
    assert row['text'][span['start']:span['end']].replace('\n', '') == '潮汐协议'
    page.locator('#menu-btn').click()
    with page.expect_download() as markdown:
        page.get_by_role('menuitem', name='导出可读剧本', exact=True).click()
    exported = markdown.value.path().read_text(encoding='utf-8')
    assert '](#encyclopedia-' + entry['id'] + ')' in exported and '北港和南港的通航约定。' in exported

    # Encountered terms also work in investigation rehearsal instead of opening another dialog.
    open_stage('stage_a1_investigation')
    page.locator('[data-investigation-card="object_letter"] .inspect-open').click()
    investigation = page.locator('[data-row="line_inv_letter"] textarea.dialogue-cell')
    investigation.fill('星塔。')
    mark(investigation, 0, 2)
    page.locator('#encyclopedia-link').click()
    page.get_by_role('button', name='演练', exact=True).click()
    page.locator('[data-investigation-visit="object_letter"]').click()
    page.locator('.encyclopedia-term').click()
    expect(page.locator('.encyclopedia-note')).to_contain_text('旧城的导航塔。')
    expect(page.get_by_role('dialog', name='演练调查')).to_have_count(1)
    page.keyboard.press('Escape')

    page.locator('#menu-btn').click()
    with page.expect_download() as saved:
        page.get_by_role('menuitem', name='下载源文件副本', exact=True).click()
    page.locator('#file-input').set_input_files(saved.value.path())
    if page.locator('#replace-discard').is_visible():
        page.locator('#replace-discard').click()
    open_stage()
    restored = snapshot()
    assert restored['encyclopedia'] == json.loads(saved.value.path().read_text(encoding='utf-8'))['encyclopedia']
    assert restored['chapters'][0]['stages'][0]['rows'][0]['encyclopediaLinks'][0] == span

    top_menu('百科')
    page.locator('.encyclopedia-entry').filter(has_text='潮汐协议').click()
    page.locator('#encyclopedia-title').fill('北港通航协议')
    page.locator('#encyclopedia-save').click()
    open_stage()
    page.locator('[data-act="read-stage"]').click()
    page.locator('.encyclopedia-term').first.click()
    expect(page.locator('.encyclopedia-note')).to_contain_text('北港通航协议')
    page.keyboard.press('Escape')
    top_menu('百科')
    page.locator('.encyclopedia-entry').filter(has_text='北港通航协议').click()
    page.locator('#encyclopedia-delete').click()
    page.locator('#confirm-yes').click()
    assert 'encyclopediaLinks' not in snapshot()['chapters'][0]['stages'][0]['rows'][0]
    assert snapshot()['chapters'][0]['stages'][0]['rows'][0]['text'] == row['text']
    page.keyboard.press('Control+z')
    assert snapshot()['chapters'][0]['stages'][0]['rows'][0]['encyclopediaLinks'][0] == span
    assert not failures, failures
    browser.close()
    print('PASS: encyclopedia management, exact text selection, preview, edit ranges, copy, export, and undo')
