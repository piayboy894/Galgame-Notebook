"""Exercise the desktop UI with mocked native IPC; never runs an installer."""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PROJECT = json.loads((ROOT / 'examples/示例剧本.story.json').read_text())
MOCK = r'''project => {
  window.isTauri = true;
  window.testCalls = [];
  window.failSave = false;
  window.updateMode = 'available';
  let serial = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => ++serial,
    invoke: async (command, args = {}) => {
      window.testCalls.push(command === 'project_command' ? args.endpoint : command);
      const opened = () => ({ name: 'sample.story.json', text: JSON.stringify(project), stamp: { size: 100, lastModified: 1, hash: 'sha256' }, bindingId: 'test-binding' });
      if (command === 'project_command') {
        if (args.endpoint === 'projects/list') return { items: [{ fileName: 'sample.story.json', title: project.title, routes: 3, chapters: 9 }] };
        if (args.endpoint === 'projects/open') return opened();
        if (args.endpoint === 'save') {
          if (window.failSave) throw { status: 409, message: '源文件已在外部修改' };
          project = JSON.parse(args.body.text); return opened();
        }
      }
      if (command === 'plugin:updater|check') {
        if (window.updateMode === 'offline') throw 'network timeout';
        if (window.updateMode === 'current') return null;
        return { rid: 7, currentVersion: '2.0.0', version: '2.1.0', body: '<img src=x onerror=alert(1)> 更新说明' };
      }
      if (command === 'plugin:updater|download_and_install') {
        args.onEvent.onmessage({ event: 'Started', data: { contentLength: 100 } });
        args.onEvent.onmessage({ event: 'Progress', data: { chunkLength: 100 } });
        return;
      }
      if (command === 'plugin:event|listen') return ++serial;
      return null;
    }
  };
}'''

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    def page():
        context = browser.new_context(viewport={'width': 1360, 'height': 900})
        context.add_init_script(f'({MOCK})({json.dumps(PROJECT, ensure_ascii=False)})')
        tab = context.new_page()
        errors = []
        tab.on('pageerror', lambda e: errors.append(str(e)))
        tab.goto(os.environ.get('APP_URL', 'http://127.0.0.1:1420'))
        expect(tab.locator('.library-open')).to_have_count(1)
        return context, tab, errors

    context, tab, errors = page()
    assert 'plugin:updater|check' not in tab.evaluate('window.testCalls')
    tab.locator('#library-update').click()
    expect(tab.locator('#update-status')).to_have_text('发现新版本 v2.1.0')
    expect(tab.locator('#update-notes img')).to_have_count(0)
    assert tab.locator('.app').evaluate('(element) => element.inert')
    tab.locator('#update-action').click()
    expect(tab.locator('#update-status')).to_contain_text('正在安装')
    calls = tab.evaluate('window.testCalls')
    assert calls.index('backup_before_update') < calls.index('plugin:updater|download_and_install') < calls.index('plugin:process|restart')
    assert not errors, errors
    context.close()

    context, tab, errors = page()
    tab.locator('.library-open').click()
    tab.locator('#project-name').fill('有未保存的修改')
    tab.evaluate('window.failSave = true')
    tab.locator('#menu-btn').click()
    tab.get_by_role('button', name='检测 GitHub 更新', exact=True).click()
    expect(tab.locator('#update-status')).to_have_text('发现新版本 v2.1.0')
    tab.locator('#update-action').click()
    expect(tab.locator('#conflict-write')).to_be_visible()
    expect(tab.locator('.update-overlay')).to_have_count(0)
    assert 'plugin:updater|download_and_install' not in tab.evaluate('window.testCalls')
    assert not errors, errors
    context.close()

    context, tab, errors = page()
    tab.evaluate('window.updateMode = "offline"')
    tab.locator('#library-update').click()
    expect(tab.locator('#update-status')).to_contain_text('network timeout')
    tab.evaluate('window.updateMode = "current"')
    tab.locator('#update-action').click()
    expect(tab.locator('#update-status')).to_have_text('当前已是最新版本。')
    tab.locator('#update-close').click()
    assert not tab.locator('.app').evaluate('(element) => element.inert')
    assert not errors, errors
    context.close()
    browser.close()
    print('PASS: desktop IPC UI, explicit checking, safe notes, download/install order, save conflict, network retry, current version')
