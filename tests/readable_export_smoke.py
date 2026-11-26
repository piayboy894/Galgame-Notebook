"""Export repeated investigation scenes for AI without losing branch context or local dialogue."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'examples/示例剧本.story.json').read_text(encoding='utf-8'))
source['version'] = 6
source['investigationPool'] = [{'id': 'pool_boat', 'name': '渡船'}]
before, after = source['chapters'][:2]
before['id'], before['title'] = 'first_visit', '初访'
after['id'], after['title'] = 'return_visit', '返访'
source['chapters'] = [before, after]
source['encyclopedia'] = [
    {'id':'lore_harbour', 'title':'雾港', 'body':'港里的信号灯由夜班船夫看守。'},
    {'id':'lore_outside', 'title':'下游城', 'body':'仅在其他章节交待的背景。'},
]

def rows(prefix):
    return [
        {'id': f'{prefix}_{number}', 'type': 'dialogue',
         'text': f'第 {number} 个标记。狭长的木船还停在雾港，水声撞上湿冷的石阶。船头的铃正随着水波响动。',
         'encyclopediaLinks': [{'entryId':'lore_harbour','start':20,'end':22}] if number == 1 else []}
        for number in range(1, 25)
    ]

original = rows('source')
variant = rows('target')
variant[9]['text'] = '这一次，渡船已经离岸。'
variant.append({
    'id': 'return_barrier', 'type': 'branch', 'text': '是否折返调查？',
    'options': [{'id':'return_answer','text':'折返','mode':'jump','chapterId':'first_visit','stageId':'dock_first'}],
})
before['summary'] = '初访才有的独有事件。'
before['stages'] = [{'id':'dock_first','title':'初次调查','kind':'investigation',
    'objects':[{'id':'boat_first','poolId':'pool_boat','rows':original}]}]
after['summary'] = '返访时，玩家才发现船已经离岸。'
after['stages'] = [{'id':'dock_next','title':'返访调查','kind':'investigation',
    'objects':[{'id':'boat_next','poolId':'pool_boat','rows':variant,
                'inheritance':{'sourceId':'boat_first','rowIds': [[a['id'], b['id']] for a,b in zip(original,variant)]}}]}]
for c in (before,after):
    c['unlock']['rules'] = []

with sync_playwright() as p:
    engine = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser = p.chromium.launch(executable_path=engine, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1360,'height':900})
    page.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'))
    page.locator('#file-input').set_input_files({
        'name':'export.story.json','mimeType':'application/json','buffer':json.dumps(source).encode()
    })
    page.locator('#menu-btn').click()
    with page.expect_download() as all_export:
        page.get_by_role('menuitem',name='导出可读剧本',exact=True).click()
    data = all_export.value.path().read_text(encoding='utf-8')
    assert data.count('第 2 个标记。') == 1 and data.count('第 24 个标记。') == 1
    assert '<a id="investigation-script-1"></a>' in data
    assert '沿用 [调查脚本 1](#investigation-script-1) 第 1–9 条' in data
    assert '沿用 [调查脚本 1](#investigation-script-1) 第 11–24 条' in data
    assert data.index('第 1–9 条') < data.index('这一次，渡船已经离岸。') < data.index('第 11–24 条')
    assert '折返' in data and '调查线 / 初访 / 初次调查' in data
    repeated = sum(len(row['text'].encode()) for row in original + variant)
    assert len(data.encode()) < repeated * 0.8, (len(data.encode()), repeated)

    page.locator('#menu-btn').click()
    page.get_by_role('menuitem',name='按范围导出可读剧本…',exact=True).click()
    page.locator('#markdown-scope').select_option('chapter:return_visit')
    with page.expect_download() as chapter_export:
        page.locator('#markdown-scope-export').click()
    single = chapter_export.value.path().read_text(encoding='utf-8')
    assert '初访才有的独有事件。' not in single and '仅在其他章节交待的背景。' not in single
    assert '第 2 个标记。' in single and '这一次，渡船已经离岸。' in single
    assert '调查线 / 初访 / 初次调查' in single
    assert '#investigation-script-' not in single
    assert '港里的信号灯由夜班船夫看守。' in single
    assert '返访' in chapter_export.value.suggested_filename
    print(f'PASS: compact full export {len(data.encode())} bytes vs {repeated} bytes of repeated dialogue alone; scoped export {len(single.encode())} bytes')
