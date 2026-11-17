"""Per-project dialogue settings, IME-safe wrapping, save/reopen and whole-library archives."""
import ast,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
PROJECT=json.loads((ROOT/'examples/示例剧本.story.json').read_text())
def fixture(path,name):
    return next(ast.literal_eval(n.value) for n in ast.parse((ROOT/path).read_text()).body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in n.targets))
BASE=fixture('tests/github_sync_smoke.py','MOCK');MOBILE=fixture('tests/android_smoke.py','MOBILE')
with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    def start(mobile=False):
        ctx=browser.new_context(viewport={'width':390 if mobile else 1360,'height':900},has_touch=mobile,is_mobile=mobile)
        script=f'({BASE})({json.dumps(PROJECT,ensure_ascii=False)});'
        if mobile:script+=f'({MOBILE})({json.dumps({"initial":PROJECT,"draft":None},ensure_ascii=False)});'
        ctx.add_init_script(script);page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'))
        page.locator('.library-open').click()
        return ctx,page,errors
    def stage(page):
        page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').click();page.locator('[data-act="open-stage"][data-id="stage_a1_1"]').click()
    def settings(page,n,mode,existing=False,mobile=False):
        if mobile:page.locator('[data-mobile-nav="settings"]').click();page.locator('[data-act="project-settings"]').click()
        else:page.locator('#menu-btn').click();page.get_by_role('menuitem',name='项目设置',exact=True).click()
        page.locator('#dialogue-line-limit').fill(str(n));page.locator('#dialogue-overflow').select_option(mode)
        if mode=='wrap':page.locator('#dialogue-format-existing').set_checked(existing)
        page.locator('#dialogue-setting-save').click()
    ctx,page,errors=start();stage(page);settings(page,3,'warn')
    line=page.locator('[data-row="line_1"] textarea.dialogue-cell');line.fill('你好👨‍👩‍👧‍👦é!😊世界')
    expect(line).to_have_attribute('aria-invalid','true');expect(page.locator('#dialogue-meter-line_1')).to_have_text('最长一行 8 / 3')
    assert page.evaluate('window.XuXian.snapshot().chapters[0].stages[0].rows[0].text')=='你好👨‍👩‍👧‍👦é!😊世界'
    settings(page,3,'wrap',True);expect(line).to_have_value('你好👨‍👩‍👧‍👦\né!😊\n世界')
    line.evaluate('e=>{e.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));e.value="中文输入法候选";e.dispatchEvent(new InputEvent("input",{bubbles:true,isComposing:true}));}')
    expect(line).to_have_value('中文输入法候选')
    line.dispatch_event('compositionend');expect(line).to_have_value('中文输\n入法候\n选')
    page.keyboard.press('Control+s');expect(page.locator('#toast')).to_contain_text('已写回')
    assert page.evaluate('window.libraryFiles["sample.story.json"].settings')=={'dialogueLineLength':3,'dialogueOverflow':'wrap'}
    page.locator('#open-btn').click();page.locator('#library-new-card').click();page.locator('#library-new-name').fill('独立项目 B');page.locator('#library-new-submit').click()
    assert page.evaluate('window.XuXian.snapshot().settings.dialogueLineLength')==0
    page.locator('#open-btn').click();page.locator('[data-project-file="sample.story.json"] .library-open').click();stage(page)
    expect(line).to_have_value('中文输\n入法候\n选');assert page.evaluate('window.XuXian.snapshot().settings.dialogueLineLength')==3
    page.locator('#open-btn').click();page.locator('#library-github').click();page.locator('#sync-repository').fill('writer/shared-data');page.locator('#sync-token').fill('fixture-token');page.locator('#sync-configure').click()
    page.locator('#archive-new').click();page.locator('#archive-name').fill('独立对白设置');page.locator('#archive-save').click();expect(page.locator('#archive-message')).to_contain_text('1 个云存档')
    assert sorted(page.evaluate('Object.values(window.archives)[0].projects.map(v=>v.project.settings.dialogueLineLength)'))==[0,3]
    assert not errors,errors;ctx.close()
    ctx,page,errors=start(True);settings(page,5,'warn',mobile=True)
    page.locator('[data-mobile-nav="outline"]').click();stage(page)
    line=page.locator('[data-row="line_1"] textarea.dialogue-cell');line.fill('手机六个字呀');expect(line).to_have_attribute('aria-invalid','true')
    rect=line.bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=390
    page.screenshot(path=str(ROOT/'work/test-results/dialogue-limit-phone.png'),full_page=True)
    assert not errors,errors;browser.close()
    print('PASS: per-project limits, Unicode counters, non-truncating wrapping, IME composition, independent project/save/reopen/cloud persistence and phone settings')
