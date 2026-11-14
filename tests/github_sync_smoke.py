"""GitHub sync UI via isolated native IPC fixtures; no personal token or real data."""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
PROJECT=json.loads((ROOT/'examples/示例剧本.story.json').read_text())
MOCK=r'''initial => {
  window.isTauri=true;
  let project=structuredClone(initial),configured=false,connection=null,serial=0;
  window.syncCalls=[];window.syncMode='upload';window.syncDelay=0;
  window.__TAURI_INTERNALS__={
    metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
    transformCallback:()=>++serial,
    invoke:async(command,args={})=>{
      const endpoint=args.endpoint;
      if(endpoint)window.syncCalls.push(endpoint);
      const opened=()=>({name:'sample.story.json',text:JSON.stringify(project),stamp:{size:100,lastModified:serial++,hash:'hash'},bindingId:'binding'});
      if(command==='project_command'){
        if(endpoint==='projects/list')return{items:[{fileName:'sample.story.json',title:project.title,routes:3,chapters:9}]};
        if(endpoint==='projects/open')return opened();
        if(endpoint==='save'||endpoint==='projects/create'){project=JSON.parse(args.body.text);return opened();}
      }
      if(command==='github_sync_command'){
        if(endpoint==='sync/settings')return{connections:configured?[{id:'connection',connection,hasToken:true}]:[],linked:configured?{connectionId:'connection',lastSync:1794640000000}:null};
        if(endpoint==='sync/configure'){
          if(args.body.token!=='fixture-token')throw{status:401,message:'令牌错误'};
          connection=args.body.connection;configured=true;return{private:true,connectionId:'connection'};
        }
        if(endpoint==='sync/inspect'){
          await new Promise(resolve=>setTimeout(resolve,window.syncDelay));
          if(window.syncMode==='offline')throw{status:503,message:'无法连接 GitHub'};
          const remote=structuredClone(project);remote.title='来自 GitHub 的剧本';
          return{planId:'plan',action:window.syncMode,path:'xuxian/projects/project_test.story.json',remoteText:window.syncMode==='upload'?null:JSON.stringify(remote)};
        }
        if(endpoint==='sync/execute'){
          if(window.syncMode==='download'||args.body.resolution==='remote')project.title='来自 GitHub 的剧本';
          return{action:args.body.resolution==='remote'?'download':(window.syncMode==='conflict'?'upload':window.syncMode),opened:opened(),lastSync:1794640000000,conflictCopy:args.body.resolution==='local'?'GitHub 冲突副本.story.json':null};
        }
        if(endpoint==='sync/disconnect'){configured=false;return{disconnected:true};}
        if(endpoint==='sync/list')return[{name:'project_restored.story.json',size:200}];
        if(endpoint==='sync/preview'){
          const remote=structuredClone(project);remote.id='project_restored';remote.title='换电脑恢复的剧本';return{text:JSON.stringify(remote),sha:'remote-sha'};
        }
        if(endpoint==='sync/restore'){
          if(args.body.sha!=='remote-sha')throw{status:409,message:'远端已变'};
          project.id='project_restored';project.title='换电脑恢复的剧本';return{opened:opened()};
        }
      }
      if(command==='plugin:event|listen')return ++serial;
      return null;
    }
  };
}'''

with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1360,'height':1000})
    context.add_init_script(f'({MOCK})({json.dumps(PROJECT,ensure_ascii=False)})')
    page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(os.environ.get('APP_URL','http://127.0.0.1:1420'))
    page.locator('.library-open').click()
    assert not any(call.startswith('sync/') for call in page.evaluate('window.syncCalls'))
    page.locator('#sync-btn').click()
    expect(page.get_by_role('dialog',name='GitHub 同步设置',exact=True)).to_be_visible()
    page.locator('#sync-repository').fill('https://github.com/writer/shared-data')
    expect(page.locator('#sync-directory')).to_have_value('xuxian/projects')
    assert page.locator('#sync-token').get_attribute('type')=='password'
    page.screenshot(path=str(ROOT/'work/test-results/github-sync-settings.png'),full_page=True)
    page.locator('#sync-token').fill('fixture-token')
    page.locator('#sync-configure').click()
    expect(page.get_by_role('dialog')).to_have_count(0)
    assert 'fixture-token' not in page.evaluate('JSON.stringify(localStorage)')
    assert 'fixture-token' not in page.evaluate('JSON.stringify(window.XuXian.snapshot())')
    page.locator('#project-name').fill('本地新改动')
    page.evaluate('window.syncDelay=250')
    page.locator('#sync-btn').click()
    expect(page.locator('#sync-progress')).to_be_visible()
    assert page.locator('.app').evaluate('element=>element.inert')
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog',name='GitHub 同步完成')).to_be_visible()
    calls=page.evaluate('window.syncCalls')
    assert calls.index('save')<calls.index('sync/inspect')<calls.index('sync/execute')
    page.get_by_role('button',name='完成',exact=True).click()
    page.evaluate('window.syncMode="download";window.syncDelay=0')
    page.locator('#sync-btn').click()
    expect(page.get_by_role('dialog',name='GitHub 同步完成')).to_be_visible()
    expect(page.locator('#project-name')).to_have_value('来自 GitHub 的剧本')
    page.get_by_role('button',name='完成',exact=True).click()
    page.evaluate('window.syncMode="conflict"')
    page.locator('#sync-btn').click()
    expect(page.get_by_role('dialog',name='双方都有改动')).to_be_visible()
    before=page.evaluate('window.syncCalls.filter(call=>call==="sync/execute").length')
    page.locator('#sync-cancel').click()
    assert before==page.evaluate('window.syncCalls.filter(call=>call==="sync/execute").length')
    page.locator('#sync-btn').click()
    page.locator('#sync-use-local').click()
    expect(page.get_by_role('dialog',name='GitHub 同步完成')).to_contain_text('GitHub 冲突副本.story.json')
    page.get_by_role('button',name='完成',exact=True).click()
    page.evaluate('window.syncMode="offline"')
    page.locator('#sync-btn').click()
    expect(page.get_by_role('dialog',name='GitHub 同步未完成')).to_contain_text('无法连接 GitHub')
    page.evaluate('window.syncMode="current"')
    page.locator('#sync-retry').click()
    expect(page.get_by_role('dialog',name='GitHub 同步完成')).to_contain_text('已一致')
    page.get_by_role('button',name='完成',exact=True).click()
    page.locator('#open-btn').click()
    page.locator('#library-github').click()
    page.locator('[data-sync-preview="0"]').click()
    expect(page.locator('#sync-remote-preview')).to_contain_text('换电脑恢复的剧本')
    page.locator('#sync-restore').click()
    expect(page.locator('#project-name')).to_have_value('换电脑恢复的剧本')
    page.screenshot(path=str(ROOT/'work/test-results/github-sync.png'),full_page=True)
    assert not errors,errors
    browser.close()
    print('PASS: private GitHub configuration, secret isolation, save-before-sync, upload/download, conflict/cancel, network retry and restore')
