"""Real Chromium touch gestures: scrolling never reorders; holds explicitly start a drag."""
from pathlib import Path
import ast,json,os
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
PROJECT=json.loads((ROOT/'examples/示例剧本.story.json').read_text())
def fixture(path,name):
    tree=ast.parse((ROOT/path).read_text())
    return next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id==name for target in node.targets))
BASE=fixture('tests/github_sync_smoke.py','MOCK')
MOBILE=fixture('tests/android_smoke.py','MOBILE')
with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
    context.add_init_script(f'({BASE})({json.dumps(PROJECT,ensure_ascii=False)});({MOBILE})({json.dumps({"initial":PROJECT,"draft":None},ensure_ascii=False)});')
    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'))
    page.locator('.library-open').tap();page.locator('[data-act="board-graph"]').tap()
    expect(page.locator('#graph-viewport')).to_be_visible()
    cdp=context.new_cdp_session(page)
    def point(x,y,id=1):return {'x':x,'y':y,'id':id}
    def touch(kind,points):cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
    def positions():return page.evaluate('window.XuXian.snapshot().chapters.map(c=>[c.id,c.routeId,c.y])')
    def anchor():
        card=page.locator('.chapter-card[data-id="chapter_a1"]')
        card.scroll_into_view_if_needed();page.wait_for_timeout(100)
        box=card.locator('.card-title').bounding_box()
        return box['x']+min(80,box['width']/2),box['y']+box['height']/2
    def swipe(x,y,dx,dy):
        touch('touchStart',[point(x,y)])
        for step in range(1,7):
            touch('touchMove',[point(x+dx*step/6,y+dy*step/6)])
            page.wait_for_timeout(30)
        touch('touchEnd',[]);page.wait_for_timeout(350)
    original=positions()
    # Swiping across a card must scroll the canvas, without moving or opening the chapter.
    for dx,dy,axis in [(0,-100,'scrollTop'),(-100,0,'scrollLeft')]:
        x,y=anchor();before=page.locator('#graph-viewport').evaluate(f'e=>e.{axis}')
        swipe(x,y,dx,dy)
        assert positions()==original
        expect(page.locator('#graph-viewport')).to_be_visible()
        assert page.locator('#graph-viewport').evaluate(f'e=>e.{axis}')>before+15,axis
    # A short tap still opens the chapter without changing its position.
    x,y=anchor();touch('touchStart',[point(x,y)]);touch('touchEnd',[])
    expect(page.locator('.stage-grid')).to_be_visible();assert positions()==original
    page.locator('#mobile-back').tap();expect(page.locator('#graph-viewport')).to_be_visible()
    # Native scrolling can start before a small movement reaches our distance threshold.
    x,y=anchor();touch('touchStart',[point(x,y)])
    page.locator('#graph-viewport').evaluate('e=>e.scrollTop+=40');page.wait_for_timeout(550)
    expect(page.locator('.touch-drag-ready')).to_have_count(0);touch('touchEnd',[])
    expect(page.locator('#graph-viewport')).to_be_visible();assert positions()==original
    # Holding without moving is not a tap and must not accidentally open a chapter.
    x,y=anchor();touch('touchStart',[point(x,y)]);page.wait_for_timeout(550)
    touch('touchEnd',[]);expect(page.locator('#graph-viewport')).to_be_visible();assert positions()==original
    # Long hold shows feedback; the project changes only when the user releases the drag.
    x,y=anchor();touch('touchStart',[point(x,y)]);page.wait_for_timeout(550)
    expect(page.locator('.touch-drag-ready')).to_have_count(1)
    before=page.locator('#graph-viewport').evaluate('e=>[e.scrollLeft,e.scrollTop]')
    touch('touchMove',[point(x,y+80)]);assert positions()==original
    assert page.locator('#graph-viewport').evaluate('e=>[e.scrollLeft,e.scrollTop]')==before
    touch('touchEnd',[]);page.wait_for_timeout(100);assert positions()!=original
    page.keyboard.press('Control+z');assert positions()==original
    # Cancellation, a second finger, Escape and rotation abandon a hold without a mutation.
    for cancel in ['touchCancel','second-finger','escape','resize']:
        x,y=anchor();touch('touchStart',[point(x,y)]);page.wait_for_timeout(550)
        expect(page.locator('.touch-drag-ready')).to_have_count(1)
        touch('touchMove',[point(x,y+40)])
        if cancel=='touchCancel':touch('touchCancel',[])
        elif cancel=='second-finger':
            touch('touchStart',[point(x,y+40),point(x+50,y+40,2)]);touch('touchEnd',[])
        elif cancel=='escape':page.keyboard.press('Escape');touch('touchEnd',[])
        else:
            page.set_viewport_size({'width':412,'height':844});touch('touchEnd',[]);page.set_viewport_size({'width':390,'height':844})
        expect(page.locator('.touch-drag-ready')).to_have_count(0);assert positions()==original,cancel
    # Mouse drag is immediate on the same touchscreen device, and remains undoable.
    x,y=anchor();page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y+80,steps=5);page.mouse.up()
    assert positions()!=original;page.keyboard.press('Control+z');assert positions()==original
    # Other drag surfaces: scrolling over script rows must not start ordering or change text.
    x,y=anchor();touch('touchStart',[point(x,y)]);touch('touchEnd',[])
    page.locator('[data-act="open-stage"][data-id="stage_a1_1"]').tap()
    rows=page.evaluate('window.XuXian.snapshot().chapters[0].stages[0].rows')
    box=page.locator('[data-row="line_1"] textarea.dialogue-cell').bounding_box()
    swipe(box['x']+60,box['y']+15,0,-100)
    assert page.evaluate('window.XuXian.snapshot().chapters[0].stages[0].rows')==rows
    expect(page.locator('.row-drag-ghost')).to_have_count(0)
    # The investigation stage shares the writing entry and exposes its scripting inside the canvas.
    page.locator('#mobile-stage-picker').tap()
    page.locator('[data-stage="stage_a1_investigation"]').tap()
    canvas=page.locator('.investigation-viewport')
    world=page.locator('.investigation-world')
    expect(canvas).to_be_visible()
    viewport=canvas.bounding_box()
    x=viewport['x']+viewport['width']/2
    y=viewport['y']+78
    initial_scale=page.get_by_role('button',name='重置缩放').inner_text()
    touch('touchStart',[point(x-35,y,1),point(x+35,y,2)])
    for delta in [49,63,77]:
        touch('touchMove',[point(x-delta,y,1),point(x+delta,y,2)])
    touch('touchEnd',[])
    expect(page.get_by_role('button',name='重置缩放')).not_to_have_text(initial_scale)
    position=world.evaluate('element => element.style.transform')
    swipe(x,y,40,36)
    assert world.evaluate('element => element.style.transform')!=position

    for _ in range(2):
        touch('touchStart',[point(x,y)])
        touch('touchEnd',[])
    page.get_by_role('menuitem',name='新建物品',exact=True).tap()
    page.locator('#inspect-name').fill('触屏物品')
    page.locator('#inspect-save').tap()
    item=page.locator('.investigation-card.is-selected')
    expect(item).to_contain_text('触屏物品')
    item.locator('[data-act="add-row"]').tap()
    line=item.locator('textarea[data-row-field="text"]')
    line.fill('在画布内编辑')
    page.evaluate('window.setNativeInput({imeVisible:true})')
    page.set_viewport_size({'width':390,'height':450})
    expect(canvas).to_be_visible()
    expect(line).to_be_focused()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    page.locator('#mobile-keyboard-done').tap()
    page.set_viewport_size({'width':390,'height':844})
    page.get_by_role('button',name='调查阶段操作').tap()
    page.get_by_role('menuitem',name='收起全部脚本').tap()
    expect(page.locator('.investigation-writing')).to_have_count(0)
    assert not errors,errors
    browser.close()
    print('PASS: native canvas scrolling, explicit long-press chapter drag, tap, cancellation/multitouch/rotation, immediate mouse drag, undo, script scrolling, and touch investigation editing')
