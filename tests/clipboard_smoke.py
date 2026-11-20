"""Exercise real clipboard shortcuts, selection, insertion and project persistence."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def content(row):
    return {key: value for key, value in row.items() if key != 'id'}


with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or (
        '/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None
    )
    browser = playwright.chromium.launch(executable_path=executable, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1360, 'height': 900})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:1420'))
    page.locator('#file-input').set_input_files(str(ROOT / 'examples/示例剧本.story.json'))
    page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click()

    def stage(stage_id):
        page.locator(f'[data-act="open-stage"][data-id="{stage_id}"]').click()

    def rows(index=0):
        return page.evaluate('i => window.XuXian.snapshot().chapters[0].stages[i].rows', index)

    def gutter(row_id):
        return page.locator(f'[data-select-row="{row_id}"]')

    def field(row_id):
        return page.locator(f'[data-row="{row_id}"] textarea[data-row-field="text"],'
                            f'[data-branch-row="{row_id}"] textarea[data-branch-field="text"]')

    def caret(row_id):
        field(row_id).focus()
        field(row_id).evaluate('e => e.setSelectionRange(0, 0)')

    def copy():
        page.keyboard.press('Control+c')

    def paste():
        page.keyboard.press('Control+v')

    stage('stage_a1_1')
    original = rows()
    gutter('line_2').click()
    copy()
    # WebViews can omit the system paste event on row numbers.
    page.evaluate("""() => window.addEventListener('paste', e => {
        e.preventDefault(); e.stopImmediatePropagation();
    }, {capture:true, once:true})""")
    gutter('line_3').click()
    paste()
    assert content(rows()[3]) == content(original[1])
    page.keyboard.press('Control+z')
    caret('line_3')
    paste()
    paste()
    result = rows()
    assert len(result) == len(original) + 2
    assert all(content(row) == content(original[1]) for row in result[3:5])
    assert len({row['id'] for row in result}) == len(result)
    assert result[2] == original[2]
    page.keyboard.press('Control+z')
    assert len(rows()) == len(original) + 1
    page.keyboard.press('Control+Shift+z')
    assert rows() == result

    # A real substring copy supersedes the row clipboard in fields and at a row number.
    caret('line_2')
    field('line_2').evaluate('e => e.setSelectionRange(0, 3)')
    copy()
    fragment = original[1]['text'][:3]
    caret('line_3')
    field('line_3').evaluate('e => e.setSelectionRange(1, 3)')
    paste()
    assert rows()[2]['text'] == original[2]['text'][:1] + fragment + original[2]['text'][3:]
    gutter('line_3').click()
    paste()
    assert len(rows()) == len(result)
    expect(page.locator('#toast')).to_contain_text('请先复制脚本行')

    # A different app can replace the OS clipboard without a copy event here.
    gutter('line_2').click()
    copy()
    other = context.new_page()
    other.set_content('<textarea>外部的普通文字</textarea>')
    other.bring_to_front()
    other.locator('textarea').focus()
    other.keyboard.press('Control+a')
    other.keyboard.press('Control+c')
    page.bring_to_front()
    gutter('line_3').click()
    paste()
    assert len(rows()) == len(result)
    expect(page.locator('#toast')).to_contain_text('请先复制脚本行')
    other.close()

    gutter('line_1').click()
    gutter('line_2').click(modifiers=['Shift'])
    copy()
    stage('stage_a1_2')
    previous = rows(1)
    gutter('line_7').click()
    paste()
    assert [content(r) for r in rows(1)[1:3]] == [content(r) for r in original[:2]]
    assert rows(1)[3:] == previous[1:]

    # A focused branch child must win over the stale selection in the outer script.
    stage('stage_a1_1')
    caret('line_local_a1')
    paste()
    branch = next(row for row in rows() if row['type'] == 'branch')
    assert [content(r) for r in branch['options'][0]['rows'][1:3]] == [content(r) for r in original[:2]]

    stage('stage_a1_investigation')
    page.locator('[data-act="inspect-select"][data-id="object_letter"]').click()
    field('line_inv_effect').fill('第一行描述\n第二行描述')
    gutter('line_inv_effect').click()
    copy()
    page.locator('[data-act="inspect-select"][data-id="object_door"]').click()
    door = page.locator('[data-inspect-item="object_door"]')
    door.locator('[data-act="inspect-rule-add"]').click()
    page.locator('#interaction-name').fill('第二次敲门')
    page.locator('#interaction-save').click()
    door.locator('.investigation-script-select').focus()
    paste()
    caret(door.locator('.script-row').first.get_attribute('data-row'))
    paste()
    def cards():
        return page.evaluate('window.XuXian.snapshot().chapters[0].stages.at(-1).objects')
    rule_rows = cards()[1]['interactions'][0]['rows']
    assert rule_rows[1]['type'] == 'effect' and rule_rows[1]['text'] == '第一行描述\n第二行描述'
    assert len(cards()[0]['rows']) == 2 and len(cards()[1]['rows']) == 2

    # Returning to the editor requires a typed OS payload. Both a native
    # clipboard round trip and an HTML-only clipboard bridge retain the row.
    gutter(rule_rows[1]['id']).click()
    page.evaluate("""() => {
        window.dispatchEvent(new Event('blur'));
        window.addEventListener('paste', e => window.rowHTML = e.clipboardData.getData('text/html'),
            {capture:true, once:true});
    }""")
    paste()
    assert len(cards()[1]['interactions'][0]['rows']) == 3
    assert content(cards()[1]['interactions'][0]['rows'][2]) == content(rule_rows[1])
    page.evaluate("""() => {
        const d = new DataTransfer();
        d.setData('text/html', window.rowHTML);
        document.activeElement.dispatchEvent(new ClipboardEvent('paste',
            {bubbles:true, cancelable:true, clipboardData:d}));
    }""")
    assert len(cards()[1]['interactions'][0]['rows']) == 4
    # Even an identical plain-text representation is never imported as a row.
    page.evaluate("""() => {
        const d = new DataTransfer();
        d.setData('text/plain', '〔演出〕第一行描述\\r\\n第二行描述');
        document.activeElement.dispatchEvent(new ClipboardEvent('paste',
            {bubbles:true, cancelable:true, clipboardData:d}));
    }""")
    assert len(cards()[1]['interactions'][0]['rows']) == 4
    expect(page.locator('#toast')).to_contain_text('请先复制调查卡片或脚本行')

    # The local shortcut still works when both system write APIs are denied.
    page.evaluate("""() => {
        document.execCommand = () => false;
        Object.defineProperty(navigator, 'clipboard', {value: {
            writeText: () => Promise.reject(new Error('clipboard unavailable'))
        }});
    }""")
    gutter('line_inv_effect').click()
    copy()
    stage('stage_a1_2')
    caret('line_7')
    paste()
    assert rows(1)[1]['type'] == 'effect' and rows(1)[1]['text'] == rule_rows[1]['text']

    saved = page.evaluate('window.XuXian.snapshot()')
    page.locator('#menu-btn').click()
    with page.expect_download() as download:
        page.get_by_role('menuitem', name='下载源文件副本', exact=True).click()
    path = download.value.path()
    exported = json.loads(path.read_text(encoding="utf-8"))
    assert exported['chapters'] == saved['chapters']
    page.reload()
    page.locator('#file-input').set_input_files({
        'name': 'clipboard.story.json', 'mimeType': 'application/json', 'buffer': path.read_bytes()
    })
    expect(page.locator('#toast')).to_contain_text('clipboard.story.json')
    assert page.evaluate('window.XuXian.snapshot().chapters') == saved['chapters']
    assert not errors, errors
    browser.close()
    print('PASS: clipboard shortcuts, text selection, repeat, metadata, rules, branches, fallbacks and save/reopen')
