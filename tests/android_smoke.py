"""Adaptive Android UI and lifecycle regressions with isolated native IPC."""
from pathlib import Path
import os,json,ast
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
PROJECT=json.loads((ROOT/'examples/示例剧本.story.json').read_text())
# Reuse the desktop fixture's project store without executing its test cases.
fixture=ast.parse((ROOT/'tests/github_sync_smoke.py').read_text())
BASE=next(ast.literal_eval(node.value) for node in fixture.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='MOCK' for target in node.targets))
MOBILE=r'''({initial,draft})=>{
  window.__XUXIAN_ANDROID__=true;window.nativeDraft=draft;window.androidCalls=[];window.installPermission=false;
  const base=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    window.androidCalls.push(args.endpoint||command);
    if(command==='plugin:app|register_listener'){window.backChannel=args.handler;return;}
    if(command==='mobile_command'){
      if(args.endpoint==='mobile/read-draft')return{epoch:1,draft:window.nativeDraft};
      if(args.endpoint==='mobile/save-draft'){window.nativeDraft=structuredClone(args.body);return{saved:true};}
      if(args.endpoint==='mobile/export'){window.exportedText=args.body.text;return{saved:true};}
      if(args.endpoint==='mobile/import'){const p=structuredClone(initial);p.id='project_android_import';p.title='Android 导入';return{name:'incoming.story.json',text:JSON.stringify(p)};}
      if(args.endpoint==='mobile/check-update')return{version:'9.0.0',notes:'<img src=x onerror=alert(1)> Android 更新说明'};
      if(args.endpoint==='mobile/install-update')return window.installPermission?{opened:true}:{permissionRequired:true};
      return{background:true};
    }
    const result=await base(command,args);
    if(command==='project_command'&&(args.endpoint==='save'||args.endpoint==='projects/create'))window.savedProject=JSON.parse(result.text);
    return result;
  };
}'''
def assert_fits(page):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    for item in page.locator('.script-row textarea:visible,.branch-script-row textarea:visible').all():
        rect=item.bounding_box()
        assert rect['x']>=-1 and rect['x']+rect['width']<=page.viewport_size['width']+1,rect
with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    def start(initial,draft=None):
        context=browser.new_context(viewport={'width':360,'height':800},has_touch=True,is_mobile=True)
        context.add_init_script(f'({BASE})({json.dumps(initial,ensure_ascii=False)});({MOBILE})({json.dumps({"initial":initial,"draft":draft},ensure_ascii=False)});')
        page=context.new_page();page.set_default_timeout(15000);errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'))
        expect(page.locator('.library-open')).to_have_count(1)
        return context,page,errors
    context,page,errors=start(PROJECT)
    expect(page.locator('#library-folder')).to_be_hidden()
    expect(page.locator('#library-migrate')).to_be_hidden()
    page.locator('.library-open').tap()
    expect(page.locator('.board-list')).to_be_visible()
    page.locator('[data-act="board-graph"]').tap()
    expect(page.locator('#graph-viewport')).to_be_visible()
    page.locator('[data-act="board-list"]').tap()
    page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').tap()
    page.locator('[data-act="open-stage"][data-id="stage_a1_1"]').tap()
    page.locator('[data-row="line_1"] .row-select').tap()
    page.locator('[data-row="line_2"] .row-select').tap()
    expect(page.locator('.selected-count')).to_have_text('2 项')
    page.locator('[data-act="group-selected"]').tap()
    page.locator('#group-title').fill('触屏建组');page.locator('#group-save').tap()
    editor=page.locator('[data-row="line_1"] textarea.dialogue-cell')
    editor.fill('手机、平板与 DeX 切换时保留编辑内容')
    for width,height,name in [(360,800,'phone'),(412,915,'wide-phone'),(800,1280,'tablet-portrait'),(1280,800,'dex'),(480,760,'split-screen'),(960,540,'tablet-landscape'),(320,520,'narrow-split'),(800,360,'phone-landscape'),(360,390,'keyboard')]:
        page.set_viewport_size({'width':width,'height':height})
        expect(editor).to_have_value('手机、平板与 DeX 切换时保留编辑内容');assert_fits(page)
        if name in ('phone','dex','split-screen','keyboard'):page.screenshot(path=str(ROOT/f'work/test-results/android-{name}.png'),full_page=True)
    page.keyboard.press('Control+s');expect(page.locator('#toast')).to_contain_text('已写回')
    editor.fill('后台草稿与重启恢复测试')
    page.wait_for_function('window.nativeDraft?.project?.chapters[0].stages[0].rows[0].rows[0].text==="后台草稿与重启恢复测试"')
    draft=page.evaluate('window.nativeDraft');saved=page.evaluate('window.savedProject')
    assert draft['view']['type']=='stage' and draft['dirty']
    page.keyboard.press('Control+s');page.locator('#menu-btn').tap()
    page.get_by_role('menuitem',name='下载源文件副本',exact=True).tap()
    page.wait_for_function('Boolean(window.exportedText)')
    assert json.loads(page.evaluate('window.exportedText'))['version']==4
    assert 'export_file' not in page.evaluate('window.androidCalls')
    page.locator('#menu-btn').tap();page.get_by_role('menuitem',name='GitHub 同步设置',exact=True).tap()
    expect(page.locator('#sync-token')).to_have_attribute('placeholder','只在本机 Android Keystore 保存')
    page.locator('[data-act="modal-close"]').first.tap()
    page.locator('#open-btn').tap();page.locator('#library-import').tap()
    expect(page.locator('#project-name')).to_have_value('Android 导入')
    page.locator('#open-btn').tap();page.locator('#library-update').tap()
    expect(page.locator('#update-status')).to_have_text('发现新版本 v9.0.0');expect(page.locator('#update-notes img')).to_have_count(0)
    page.locator('#update-action').tap();expect(page.locator('#update-status')).to_contain_text('请允许叙线安装应用')
    page.evaluate('window.installPermission=true');page.locator('#update-action').tap()
    expect(page.locator('#update-status')).to_have_text('发现新版本 v9.0.0')
    page.locator('#update-action').tap();expect(page.locator('#update-status')).to_contain_text('系统安装器已打开')
    page.locator('#update-close').tap();assert not errors,errors;context.close()
    context,page,errors=start(saved,draft);page.locator('#library-close').tap()
    expect(page.locator('[data-row="line_1"] textarea.dialogue-cell')).to_have_value('后台草稿与重启恢复测试')
    page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('.stage-grid')).to_be_visible()
    page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('.board-list')).to_be_visible()
    page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('#project-library')).to_be_visible()
    page.evaluate('window.backChannel.onmessage({canGoBack:false})')
    page.wait_for_function('window.androidCalls.includes("mobile/background")')
    assert not errors,errors;browser.close()
    print('PASS: Android files, touch grouping, 9 window sizes, keyboard/DeX, draft recovery, back navigation and installer flow')
