"""Inline phone writing and Samsung tablet/DeX hybrid input regressions."""
from pathlib import Path
import os,json,ast
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
PROJECT=json.loads((ROOT/'examples/示例剧本.story.json').read_text())
fixture=ast.parse((ROOT/'tests/github_sync_smoke.py').read_text())
BASE=next(ast.literal_eval(node.value) for node in fixture.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='MOCK' for target in node.targets))
MOBILE=r'''({initial,draft})=>{
  window.__XUXIAN_ANDROID__=true;window.nativeDraft=draft;window.androidCalls=[];window.installPermission=false;
  window.nativeInputState={imeVisible:false,hardwareKeyboard:false};
  window.setNativeInput=state=>{window.nativeInputState={...window.nativeInputState,...state};window.dispatchEvent(new CustomEvent('xuxian:input-state',{detail:window.nativeInputState}));};
  const base=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    window.androidCalls.push(args.endpoint||command);
    if(command==='plugin:app|register_listener'){window.backChannel=args.handler;return;}
    if(command==='mobile_command'){
      if(args.endpoint==='mobile/read-draft')return{epoch:1,draft:window.nativeDraft};
      if(args.endpoint==='mobile/save-draft'){window.nativeDraft=structuredClone(args.body);return{saved:true};}
      if(args.endpoint==='mobile/input-state')return window.nativeInputState;
      if(args.endpoint==='mobile/hide-keyboard'){window.setNativeInput({imeVisible:false});return{};}
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
def fits(page):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    rects=page.locator('.script-row textarea:visible,.branch-script-row textarea:visible').evaluate_all('(elements)=>elements.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,width:r.width};})')
    assert rects
    for rect in rects:
        assert rect['x']>=-1 and rect['x']+rect['width']<=page.viewport_size['width']+1,rect
with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    def start(initial,draft=None,width=390,height=844,revision='legacy'):
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=True,is_mobile=True)
        context.add_init_script(f'({BASE})({json.dumps(initial,ensure_ascii=False)});window.libraryRevision={json.dumps(revision)};({MOBILE})({json.dumps({"initial":initial,"draft":draft},ensure_ascii=False)});')
        page=context.new_page();page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'));expect(page.locator('.library-open')).to_have_count(1)
        return context,page,errors
    def open_stage(page):
        page.locator('.library-open').tap();page.locator('[data-act="open-chapter"][data-id="chapter_a1"]').tap();page.locator('[data-act="open-stage"][data-id="stage_a1_1"]').tap()
    context,page,errors=start(PROJECT);open_stage(page)
    expect(page.locator('#sync-btn')).to_have_count(0);expect(page.locator('#mobile-nav')).to_be_visible()
    line=page.locator('[data-row="line_1"] textarea.dialogue-cell');line.tap();line.fill('直接在列表编辑，不进入二级页面')
    expect(page.get_by_role('dialog')).to_have_count(0);expect(line).to_be_focused()
    page.locator('[data-mobile-details="line_1"]').tap();expression=page.locator('[data-row="line_1"] .expression-cell');expect(expression).to_be_visible();expression.fill('认真')
    page.locator('[data-row="line_1"] .action-cell').fill('合上书');expect(page.locator('[data-mobile-details="line_1"]')).to_contain_text('认真 · 合上书')
    # Real IME visibility, not a height heuristic, controls the keyboard accessory.
    line.tap();page.evaluate('window.setNativeInput({imeVisible:true})');page.set_viewport_size({'width':390,'height':450})
    expect(page.locator('#mobile-nav')).to_be_hidden();expect(page.locator('#mobile-keyboard-bar')).to_be_visible()
    page.locator('#mobile-keyboard-next').tap();expect(page.locator('[data-row="line_2"] textarea.dialogue-cell')).to_be_focused()
    page.locator('#mobile-keyboard-previous').tap();expect(line).to_be_focused()
    page.locator('#mobile-keyboard-done').tap();expect(page.locator('#mobile-nav')).to_be_visible();assert 'mobile/hide-keyboard' in page.evaluate('window.androidCalls')
    page.set_viewport_size({'width':390,'height':844})
    # Touch sheets replace nested desktop popups. Android Back first pops the sheet stack.
    page.locator('[data-row="line_1"] [data-act="row-menu"]').tap();expect(page.locator('.touch-menu-sheet')).to_be_visible()
    page.get_by_role('menuitem',name='在上方插入',exact=True).tap();expect(page.locator('.touch-menu-sheet')).to_have_attribute('aria-label','在上方插入')
    page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('.touch-menu-sheet')).to_have_attribute('aria-label','操作')
    page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('.touch-menu-sheet')).to_have_count(0)
    page.locator('[data-row="line_1"] .row-select').tap();page.locator('[data-row="line_2"] .row-select').tap();expect(page.locator('.selected-count')).to_have_text('2 项')
    page.locator('[data-act="group-selected"]').tap();page.locator('#group-title').fill('手机行内建组');page.locator('#group-save').tap()
    if page.locator('[data-act="clear-rows"]').is_visible():page.locator('[data-act="clear-rows"]').tap()
    line=page.locator('[data-row="line_1"] textarea.dialogue-cell');line.fill('手机、平板、键鼠切换时保留编辑和光标');line.focus();line.evaluate('e=>e.setSelectionRange(3,7)')
    for width,height,name in [(360,800,'phone'),(412,915,'wide-phone'),(600,800,'narrow-tablet'),(700,800,'medium-tablet'),(800,1280,'tablet-portrait'),(1280,800,'dex'),(480,760,'split-screen'),(960,540,'tablet-landscape'),(320,520,'narrow-split'),(800,360,'phone-landscape'),(360,390,'keyboard')]:
        page.set_viewport_size({'width':width,'height':height});expect(line).to_have_value('手机、平板、键鼠切换时保留编辑和光标');expect(line).to_be_focused();assert line.evaluate('e=>[e.selectionStart,e.selectionEnd]')==[3,7];fits(page)
        if name in ('phone','dex','split-screen','keyboard'):page.screenshot(path=str(ROOT/f'work/test-results/android-inline-{name}.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.keyboard.press('Control+s');expect(page.locator('#toast')).to_contain_text('已写回')
    line.fill('后台草稿与重启恢复测试');page.wait_for_function('window.nativeDraft?.project?.chapters[0].stages[0].rows[0].rows[0].text==="后台草稿与重启恢复测试"')
    draft=page.evaluate('window.nativeDraft');saved=page.evaluate('window.savedProject')
    page.locator('#mobile-more').tap();page.get_by_role('menuitem',name='导出源文件',exact=True).tap();page.wait_for_function('Boolean(window.exportedText)');assert json.loads(page.evaluate('window.exportedText'))['version']==5
    page.locator('[data-mobile-nav="library"]').tap();page.locator('#mobile-library-more').tap();page.get_by_role('menuitem',name='云存档连接设置',exact=True).tap();expect(page.locator('#sync-token')).to_have_attribute('placeholder','只在本机 Android Keystore 保存');page.locator('[data-act="modal-close"]').first.tap()
    page.locator('#mobile-library-more').tap();page.get_by_role('menuitem',name='检测软件更新',exact=True).tap();expect(page.locator('#update-status')).to_have_text('发现新版本 v9.0.0');expect(page.locator('#update-notes img')).to_have_count(0)
    page.locator('#update-action').tap();expect(page.locator('#update-status')).to_contain_text('请允许叙线安装应用');page.evaluate('window.installPermission=true');page.locator('#update-action').tap();expect(page.locator('#update-status')).to_have_text('发现新版本 v9.0.0');page.locator('#update-action').tap();expect(page.locator('#update-status')).to_contain_text('系统安装器已打开');page.locator('#update-close').tap()
    assert not errors,errors;context.close()
    # Tablet keeps mouse semantics even when Android reports that a touchscreen is attached.
    context,page,errors=start(PROJECT,width=1280,height=800);open_stage(page);page.evaluate('window.setNativeInput({hardwareKeyboard:true})')
    first=page.locator('[data-row="line_1"] .row-select');second=page.locator('[data-row="line_2"] .row-select');third=page.locator('[data-row="line_3"] .row-select')
    first.click();second.click(modifiers=['Control']);expect(page.locator('.selected-count')).to_have_text('2 项')
    third.click();expect(page.locator('.selected-count')).to_have_text('1 项');first.click();third.click(modifiers=['Shift']);expect(page.locator('.selected-count')).to_have_text('3 项')
    second.click(button='right');expect(page.get_by_role('menuitem',name='在下方插入',exact=True)).to_be_visible();expect(page.locator('.touch-menu-sheet')).to_have_count(0);page.keyboard.press('Escape')
    first.focus();page.keyboard.press('Shift+F10');expect(page.get_by_role('menuitem',name='在上方插入',exact=True)).to_be_visible();page.keyboard.press('Escape')
    first.click();second.click(modifiers=['Control']);page.keyboard.press('Control+g');page.locator('#group-title').fill('键鼠建组');page.locator('#group-save').click();expect(page.locator('.scene-group-title')).to_contain_text('键鼠建组');page.keyboard.press('Control+z');expect(page.locator('.scene-group-title')).to_have_count(0)
    field=page.locator('[data-row="line_1"] textarea.dialogue-cell');field.click();page.keyboard.type('DeX');page.keyboard.press('Control+s');expect(page.locator('#toast')).to_contain_text('已写回')
    # Touch and mouse can alternate in a compact split window without sticky touch-selection rules.
    page.set_viewport_size({'width':480,'height':760});first.tap();second.tap();expect(page.locator('.selected-count')).to_have_text('2 项');third.click();expect(page.locator('.selected-count')).to_have_text('1 项')
    page.keyboard.press('Control+/');expect(page.get_by_role('dialog',name='键盘快捷键')).to_be_visible();page.keyboard.press('Escape')
    # Landscape tablets should dedicate most of the screen to the canvas, even while typing.
    page.set_viewport_size({'width':1280,'height':750})
    page.locator('.stage-tab[data-id="stage_a1_investigation"]').tap()
    canvas = page.locator('.investigation-viewport')
    toolbar = page.get_by_role('group',name='调查工具')
    picker = toolbar.get_by_role('combobox',name='切换阶段')
    expect(picker).to_have_value('stage_a1_investigation')
    expect(page.locator('#view .crumbs, #view .stage-header, #view .stage-tabs')).to_have_count(0)
    assert canvas.bounding_box()['y'] <= 110 and canvas.bounding_box()['height'] >= 635
    toolbar.get_by_role('button',name='调查阶段操作').tap()
    page.get_by_role('menuitem',name='阶段笔记').tap()
    expect(page.get_by_role('dialog',name='阶段笔记')).to_be_visible()
    page.keyboard.press('Escape')
    picker.select_option('stage_a1_1')
    expect(page.locator('.stage-tab.active')).to_have_attribute('data-id','stage_a1_1')
    page.locator('.stage-tab[data-id="stage_a1_investigation"]').tap()
    page.locator('[data-investigation-card="object_letter"] .inspect-open').tap()
    dialogue = page.locator('[data-row="line_inv_letter"] textarea.dialogue-cell')
    dialogue.tap()
    dialogue.fill('横屏时直接编辑调查对白')
    dialogue.evaluate('e=>e.setSelectionRange(2,5)')
    world = page.locator('.investigation-world')
    camera = world.evaluate('e=>e.style.transform')
    page.evaluate('window.setNativeInput({imeVisible:true,hardwareKeyboard:false})')
    page.set_viewport_size({'width':1280,'height':415})
    expect(page.locator('.topbar')).to_be_hidden()
    expect(page.locator('#mobile-nav')).to_be_hidden()
    expect(page.locator('#mobile-keyboard-bar')).to_be_visible()
    expect(dialogue).to_be_focused()
    assert dialogue.evaluate('e=>[e.selectionStart,e.selectionEnd]') == [2,5]
    viewport_rect, dialogue_rect = canvas.bounding_box(), dialogue.bounding_box()
    assert viewport_rect['y'] <= 54 and viewport_rect['height'] >= 300
    assert viewport_rect['y'] <= dialogue_rect['y'] and dialogue_rect['y'] + dialogue_rect['height'] <= viewport_rect['y'] + viewport_rect['height']
    page.locator('#mobile-keyboard-done').tap()
    page.set_viewport_size({'width':1280,'height':750})
    expect(page.locator('.topbar')).to_be_visible()
    expect(page.locator('#mobile-nav')).to_be_visible()
    assert world.evaluate('e=>e.style.transform') == camera
    assert page.locator('[data-investigation-card="object_letter"]').bounding_box()['y'] >= canvas.bounding_box()['y']
    page.screenshot(path=str(ROOT/'work/test-results/android-investigation-landscape.png'),full_page=True)
    for width in (850, 620, 600, 540, 360, 320):
        page.set_viewport_size({'width':width,'height':540})
        assert toolbar.evaluate('e=>e.scrollWidth<=e.clientWidth+1 && e.offsetHeight<=54'),width
    expect(page.locator('#mobile-stage-bar')).to_be_hidden()
    toolbar.get_by_role('button',name='调查阶段操作').tap()
    page.get_by_role('menuitem',name='多选脚本行').tap()
    expect(page.locator('html.phone-ui.mobile-selecting')).to_have_count(1)
    assert not errors,errors;context.close()
    # A restarted phone must read the loaded source, rather than an old clean demonstration cache.
    loaded=json.loads(json.dumps(PROJECT));loaded['id']='cloud-loaded-project';loaded['title']='云端已保存项目'
    old_clean={'project':PROJECT,'sourceName':'sample.story.json','dirty':False,'view':{'type':'board'},'libraryRevision':'loaded-library','savedAt':'2026-11-15T00:00:00Z'}
    context,page,errors=start(loaded,old_clean,revision='loaded-library')
    expect(page.locator('#project-name')).to_have_value('云端已保存项目');page.locator('#library-close').tap()
    assert page.evaluate('window.XuXian.snapshot().id')=='cloud-loaded-project'
    page.evaluate('window.dispatchEvent(new Event("pagehide"))');page.wait_for_function('window.nativeDraft?.project?.title==="云端已保存项目"')
    loaded_draft=page.evaluate('window.nativeDraft');assert not errors,errors;context.close()
    context,page,errors=start(loaded,loaded_draft,revision='loaded-library');expect(page.locator('#project-name')).to_have_value('云端已保存项目');assert not errors,errors;context.close()
    # Older versions cached an empty editor after reading a library. Never restore that screen.
    placeholder={**old_clean,'sourceName':''}
    context,page,errors=start(loaded,placeholder,revision='loaded-library');expect(page.locator('#library-close')).to_be_hidden();expect(page.locator('.library-open')).to_contain_text('云端已保存项目');assert not errors,errors;context.close()
    context,page,errors=start(saved,draft);page.locator('#library-close').tap();expect(page.locator('[data-row="line_1"] textarea.dialogue-cell')).to_have_value('后台草稿与重启恢复测试')
    page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('.stage-grid')).to_be_visible();page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('.board-list')).to_be_visible();page.evaluate('window.backChannel.onmessage({canGoBack:false})');expect(page.locator('#project-library')).to_be_visible();page.evaluate('window.backChannel.onmessage({canGoBack:false})');page.wait_for_function('window.androidCalls.includes("mobile/background")')
    assert not errors,errors;browser.close();print('PASS: phone editing, IME accessory and caret retention, compact tablet investigation, Samsung hybrid input, draft recovery and installer')
