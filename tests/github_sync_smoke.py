"""Global library save/load slots: isolated IPC, no real account or personal data."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
PROJECT=json.loads((ROOT/'examples/示例剧本.story.json').read_text())
MOCK=r'''initial=>{
  window.isTauri=true;let files={'sample.story.json':structuredClone(initial)},serial=0,configured=false,connection=null;
  const bindings=new Map();let currentName='sample.story.json';
  window.syncCalls=[];window.archives={};window.archiveMode='normal';window.archiveDelay=0;window.libraryRevision='legacy';window.legacyCount=4;
  const expose=()=>window.libraryFiles=files;expose();
  window.installLibraryFixture=(values,revision)=>{files=structuredClone(values);expose();window.libraryRevision=revision;};
  const clone=value=>structuredClone(value);
  const opened=(name=currentName)=>{currentName=name;const key='binding-'+(++serial);bindings.set(key,name);return{name,text:JSON.stringify(files[name]),stamp:{size:100,lastModified:serial,hash:'hash-'+serial},bindingId:key};};
  window.addSecondProject=()=>{const next=clone(initial);next.id='project_second';next.title='第二个独立项目';files['second.story.json']=next;expose();};
  window.addThirdProject=()=>{const next=clone(initial);next.id='project_third';next.title='仅本机第三个项目';files['third.story.json']=next;expose();};
  const loadLibrary=archive=>{
    files=Object.fromEntries(archive.projects.map(item=>[item.fileName,clone(item.project)]));expose();bindings.clear();window.libraryRevision='generation-'+(++serial);
    return{opened:null,projectCount:archive.projects.length,revision:window.libraryRevision};
  };
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>++serial,
    invoke:async(command,args={})=>{
      const endpoint=args.endpoint;if(endpoint)window.syncCalls.push(endpoint);const body=args.body||{};
      if(command==='project_command'){
        if(endpoint==='projects/library-revision')return{revision:window.libraryRevision};
        if(endpoint==='projects/list')return{items:Object.entries(files).map(([fileName,p])=>({fileName,title:p.title,routes:p.routes.length,chapters:p.chapters.length}))};
        if(endpoint==='projects/open')return opened(body.fileName);
        if(endpoint==='save'){const name=bindings.get(body.bindingId)||currentName;files[name]=JSON.parse(body.text);expose();return opened(name);}
        if(endpoint==='projects/create'){const p=JSON.parse(body.text),name='created-'+(++serial)+'.story.json';files[name]=p;expose();return opened(name);}
      }
      if(command==='github_sync_command'){
        if(endpoint==='sync/settings')return{connections:configured?[{id:'connection',connection,hasToken:true}]:[],linked:null};
        if(endpoint==='sync/configure'){
          if(body.token!=='fixture-token'&&!(configured&&!body.token))throw{status:401,message:'令牌错误'};
          connection=clone(body.connection);configured=true;return{private:true,connectionId:'connection'};
        }
        await new Promise(resolve=>setTimeout(resolve,window.archiveDelay));
        if(window.archiveMode==='offline')throw{status:503,message:'无法连接 GitHub，请重试'};
        if(endpoint==='sync/archive-list')return{slots:Object.entries(window.archives).map(([fileName,a])=>({fileName,sha:a.sha,name:a.name,note:a.note,savedAt:a.savedAt,projectCount:a.projects.length})),legacyCount:window.legacyCount};
        if(endpoint==='sync/archive-save'){
          if(window.archiveMode==='race')throw{status:409,message:'目标云存档已变化，请刷新预览后手动重试'};
          const fileName=body.fileName||'library-'+String(++serial).padStart(32,'0')+'.xuxian-save.json';
          if(body.fileName&&window.archives[fileName]?.sha!==body.sha)throw{status:409,message:'目标云存档已变化'};
          const archive={name:body.name,note:body.note,savedAt:1794800000000,sha:'cloud-'+(++serial),projects:Object.entries(files).map(([fileName,project])=>({fileName,project:clone(project)}))};
          window.archives[fileName]=archive;return{fileName,projectCount:archive.projects.length,name:archive.name};
        }
        if(endpoint==='sync/archive-preview'){
          const a=window.archives[body.fileName];return{fileName:body.fileName,sha:a.sha,name:a.name,note:a.note,savedAt:a.savedAt,projectCount:a.projects.length,projects:a.projects.map(v=>({fileName:v.fileName,title:v.project.title}))};
        }
        if(endpoint==='sync/archive-load'){
          if(window.archiveMode==='race'||window.archives[body.fileName]?.sha!==body.sha)throw{status:409,message:'云存档在预览后发生变化，请刷新后再读档'};
          return loadLibrary(clone(window.archives[body.fileName]));
        }
        if(endpoint==='sync/archive-delete'){
          if(window.archives[body.fileName]?.sha!==body.sha)throw{status:409,message:'目标云存档已变化'};
          delete window.archives[body.fileName];return{deleted:true};
        }
        throw Error('Retired automatic sync endpoint called: '+endpoint);
      }
      if(command==='plugin:event|listen')return ++serial;
      return null;
    }
  };
}'''
with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox']);context=browser.new_context(viewport={'width':1360,'height':1000})
    context.add_init_script(f'({MOCK})({json.dumps(PROJECT,ensure_ascii=False)})');page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)));page.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'))
    page.locator('.library-open').click();expect(page.locator('#sync-btn')).to_have_count(0)
    page.locator('#menu-btn').click();expect(page.get_by_role('menuitem',name='GitHub 一键同步',exact=True)).to_have_count(0);page.keyboard.press('Escape')
    assert not any(call.startswith('sync/') for call in page.evaluate('window.syncCalls'))
    page.locator('#project-name').fill('当前尚未保存的改动');page.evaluate('window.addSecondProject()');page.locator('#open-btn').click();page.locator('#library-github').click()
    expect(page.get_by_role('dialog',name='全局云存档连接',exact=True)).to_be_visible();page.locator('#sync-repository').fill('https://github.com/writer/shared-data');page.locator('#sync-token').fill('fixture-token');page.locator('#sync-configure').click()
    expect(page.locator('#archive-new')).to_be_visible();expect(page.locator('#archive-legacy')).to_have_count(0);expect(page.locator('#archive-local')).to_have_count(0);assert 'fixture-token' not in page.evaluate('JSON.stringify(localStorage)');assert 'fixture-token' not in page.evaluate('JSON.stringify(window.XuXian.snapshot())')
    stale=page.evaluate('JSON.parse(localStorage.getItem("xuxian.draft.v1"))');stale['project']['title']='不应复活的旧草稿'
    page.locator('#archive-new').click();page.locator('#archive-name').fill('全库 A');page.locator('#archive-note').fill('<img src=x onerror=alert(1)> 两个项目')
    page.evaluate('window.archiveDelay=100');page.locator('#archive-save').click();expect(page.locator('#archive-message')).to_contain_text('1 个云存档')
    assert page.evaluate('Object.values(window.archives)[0].projects.length')==2
    assert page.evaluate('Object.values(window.archives)[0].projects.some(v=>v.project.title==="当前尚未保存的改动")')
    calls=page.evaluate('window.syncCalls');assert calls.index('save')<calls.index('sync/archive-save')
    page.locator('[data-archive-slot="0"]').click();expect(page.get_by_role('dialog')).to_contain_text('2 个项目');expect(page.locator('#modal-root img')).to_have_count(0)
    before=page.evaluate('window.syncCalls.filter(c=>c==="sync/archive-load").length');page.locator('#archive-load').click();expect(page.get_by_role('dialog')).to_contain_text('本机整个项目库');expect(page.get_by_role('dialog')).to_contain_text('不会先保存');page.locator('#archive-load-cancel').click()
    assert before==page.evaluate('window.syncCalls.filter(c=>c==="sync/archive-load").length')
    page.evaluate('window.addThirdProject()');page.locator('[data-archive-slot="0"]').click();page.locator('#archive-overwrite').click();page.locator('#archive-name').fill('全库 A 覆盖');page.locator('#archive-save').click();expect(page.locator('#archive-message')).to_contain_text('1 个云存档')
    assert page.evaluate('Object.values(window.archives)[0].projects.length')==3
    page.locator('#archive-new').click();page.locator('#archive-name').fill('全库 B');page.locator('#archive-save').click();expect(page.locator('#archive-message')).to_contain_text('2 个云存档')
    # Load the first save after changing local data; no direction or merge is chosen for us.
    page.locator('[data-act="modal-close"]').first.click();page.locator('#library-close').click()
    page.locator('#project-name').fill('读档时应丢弃的未保存改动');page.locator('#open-btn').click();page.locator('#library-github').click()
    page.evaluate('delete window.libraryFiles["second.story.json"]')
    writes_before=page.evaluate('window.syncCalls.filter(c=>c==="save"||c==="projects/create"||c.includes("backup")).length')
    page.locator('[data-archive-slot="0"]').click();page.evaluate('window.archiveMode="race"');page.locator('#archive-load').click();page.locator('#archive-load-confirm').click();expect(page.locator('#archive-message')).to_contain_text('变化')
    assert page.evaluate('Object.keys(window.libraryFiles).length')==2
    assert page.evaluate('window.XuXian.snapshot().title')=='读档时应丢弃的未保存改动'
    page.evaluate('window.archiveMode="normal"');page.locator('#archive-load-confirm').click();expect(page.locator('.library-open')).to_have_count(3)
    assert writes_before==page.evaluate('window.syncCalls.filter(c=>c==="save"||c==="projects/create"||c.includes("backup")).length')
    assert all(value['title']!='读档时应丢弃的未保存改动' for value in page.evaluate('window.libraryFiles').values())
    page.locator('#library-github').click();page.locator('[data-archive-slot="0"]').click();page.locator('#archive-delete').click();page.locator('#archive-delete-cancel').click()
    assert len(page.evaluate('Object.keys(window.archives)'))==2
    page.locator('[data-archive-slot="0"]').click();page.locator('#archive-delete').click();page.locator('#archive-delete-confirm').click();expect(page.locator('[data-archive-slot]')).to_have_count(1)
    assert page.evaluate('Object.keys(window.libraryFiles).length')==3
    page.evaluate('window.archiveMode="offline"');page.locator('#archive-refresh').click();expect(page.locator('#archive-message')).to_contain_text('无法连接')
    page.evaluate('window.archiveMode="normal"');page.locator('#archive-refresh').click();expect(page.locator('[data-archive-slot]')).to_have_count(1)
    calls=page.evaluate('window.syncCalls');assert not any(c in ('sync/inspect','sync/execute','sync/restore') for c in calls)
    native_files=page.evaluate('window.libraryFiles');revision=page.evaluate('window.libraryRevision')
    fresh=browser.new_context(viewport={'width':1360,'height':1000})
    fresh.add_init_script(f'({MOCK})({json.dumps(PROJECT,ensure_ascii=False)});window.installLibraryFixture({json.dumps(native_files,ensure_ascii=False)},{json.dumps(revision)});localStorage.setItem("xuxian.draft.v1",JSON.stringify({json.dumps(stale,ensure_ascii=False)}));')
    restored=fresh.new_page();restored.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'));expect(restored.locator('.library-open')).to_have_count(3)
    assert restored.evaluate('window.XuXian.snapshot().title')!='不应复活的旧草稿'
    fresh.close()
    assert not errors,errors
    browser.close();print('PASS: global slots, direct load without saving/backups, no legacy collection, cancellation, stale-preview protection, secret isolation and full-library snapshots')
