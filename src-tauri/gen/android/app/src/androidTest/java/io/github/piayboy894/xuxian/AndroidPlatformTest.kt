package io.github.piayboy894.xuxian

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.view.KeyboardShortcutGroup
import android.view.KeyEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class AndroidPlatformTest {
  @Test fun tokenVaultKeepsOnlyAuthenticatedCiphertext() {
    val context=InstrumentationRegistry.getInstrumentation().targetContext
    val vault=TokenVault(context)
    val key="e".repeat(64);val value="android-instrumentation-fixture-token"
    vault.set(key,value);assertEquals(value,vault.get(key))
    val stored=context.getSharedPreferences("xuxian-vault",0).getString(key,null)!!
    assertFalse(stored.contains(value))
    vault.set(key,"replacement-fixture-token");assertEquals("replacement-fixture-token",vault.get(key))
    vault.delete(key);assertNull(vault.get(key))
  }
  private fun webView(view:View):WebView? {
    if(view is WebView)return view
    if(view is ViewGroup)for(index in 0 until view.childCount)webView(view.getChildAt(index))?.let{return it}
    return null
  }
  private fun js(scenario:ActivityScenario<MainActivity>,script:String):String {
    val result=AtomicReference<String>();val done=CountDownLatch(1)
    scenario.onActivity { activity ->
      val browser=webView(activity.findViewById(android.R.id.content))
      if(browser==null){result.set("no-webview");done.countDown()}
      else browser.evaluateJavascript(script){value->result.set(value);done.countDown()}
    }
    assertTrue("WebView callback timed out",done.await(10,TimeUnit.SECONDS))
    return result.get()
  }
  private fun ready(scenario:ActivityScenario<MainActivity>,expression:String) {
    repeat(50){if(js(scenario,"Boolean($expression)")=="true")return;Thread.sleep(200)}
    fail("Android editor did not become ready: "+js(scenario,"document.body.innerText.slice(0,300)"))
  }
  @Test fun nativeBridgePickerAndDraftSurviveActivityRecreation() {
    val scenario=ActivityScenario.launch(MainActivity::class.java)
    try {
      ready(scenario,"window.XuXian && document.querySelector('.library-open')")
      assertEquals("true",js(scenario,"window.__XUXIAN_ANDROID__===true"))
      scenario.onActivity { activity ->
        assertEquals("叙线",activity.title.toString())
        val icon=activity.getDrawable(io.github.piayboy894.xuxian.R.mipmap.ic_launcher) as android.graphics.drawable.AdaptiveIconDrawable
        val background=icon.background as android.graphics.drawable.ColorDrawable
        assertEquals(android.graphics.Color.parseColor("#243239"),background.color)
        val groups=mutableListOf<KeyboardShortcutGroup>()
        activity.onProvideKeyboardShortcuts(groups,null,0)
        assertTrue(groups.any{it.label.toString()=="叙线" && it.items.any{key->key.keycode==KeyEvent.KEYCODE_S}})
      }
      // Exercise real IME insets and the inline editor, with no second editing screen.
      js(scenario,"document.querySelector('.library-open').click();true")
      // The default editor exists underneath the project library while native I/O is pending.
      // Wait for adoption; otherwise clicks navigate that old editor before adoption resets it.
      ready(scenario,"document.querySelector('#project-library').classList.contains('hidden') && document.querySelector('#view [data-act=\"open-chapter\"]')")
      js(scenario,"document.querySelector('#view [data-act=\"open-chapter\"]').click();true")
      ready(scenario,"document.querySelector('#view .stage-card[data-act=\"open-stage\"]')")
      js(scenario,"document.querySelector('#view .stage-card[data-act=\"open-stage\"]').click();true")
      ready(scenario,"document.querySelector('textarea.dialogue-cell')")
      val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
      js(scenario,"document.querySelector('textarea.dialogue-cell').scrollIntoView({block:'center'});true")
      ready(scenario,"(()=>{const r=document.querySelector('textarea.dialogue-cell').getBoundingClientRect();return r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight;})()")
      val field=JSONArray(js(scenario,"(()=>{const r=document.querySelector('textarea.dialogue-cell').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth];})()"))
      val tap=IntArray(2)
      scenario.onActivity { activity ->
        val browser=webView(activity.findViewById(android.R.id.content))!!
        browser.getLocationOnScreen(tap)
        val scale=browser.width/field.getDouble(2)
        tap[0]+=(field.getDouble(0)*scale).toInt()
        tap[1]+=(field.getDouble(1)*scale).toInt()
      }
      // Touch the actual visible field. WebView's virtual accessibility descendants may lag
      // behind navigation; DOM geometry is only used to locate, never to focus or show the IME.
      assertTrue("Could not tap the inline dialogue",device.click(tap[0],tap[1]))
      ready(scenario,"document.activeElement.matches('textarea.dialogue-cell')")
      ready(scenario,"document.documentElement.classList.contains('ime-visible') && getComputedStyle(document.querySelector('#mobile-keyboard-bar')).display!=='none'")
      assertEquals("0",js(scenario,"document.querySelectorAll('#modal-root .modal').length"))
      js(scenario,"window.__imeHidden=false;window.__TAURI_INTERNALS__.invoke('mobile_command',{endpoint:'mobile/hide-keyboard',body:{}}).then(()=>window.__imeHidden=true);true")
      ready(scenario,"window.__imeHidden && !document.documentElement.classList.contains('ime-visible')")
      // Physical Ctrl+C/V must also work when the destination is a row number.
      js(scenario,"""(() => {
        const field = document.querySelector('textarea.dialogue-cell');
        field.focus(); field.setSelectionRange(0, 0);
        window.clipboardSource = field.value;
        window.initialRows = document.querySelectorAll('.script-rows > .script-row').length;
      })()""")
      assertTrue(device.pressKeyCode(KeyEvent.KEYCODE_C, KeyEvent.META_CTRL_ON))
      ready(scenario,"document.querySelector('#toast').textContent.includes('已复制 1 行')")
      js(scenario,"document.querySelector('.script-rows > .script-row .row-select').focus();true")
      assertTrue(device.pressKeyCode(KeyEvent.KEYCODE_V, KeyEvent.META_CTRL_ON))
      ready(scenario,"document.querySelectorAll('.script-rows > .script-row').length === window.initialRows + 1")
      assertEquals("true",js(scenario,"document.querySelector('.script-row.selected textarea.dialogue-cell').value === window.clipboardSource"))
      // This round trip exercises Rust -> Kotlin plugin registration and the system document picker.
      js(scenario,"""window.__picker='pending';window.__TAURI_INTERNALS__.invoke('mobile_command',{endpoint:'mobile/import',body:{}}).then(r=>window.__picker=r.cancelled?'ok':'selected').catch(e=>window.__picker='error');true""")
      var pickerReady=false
      for(attempt in 0 until 50) {
        val name=device.currentPackageName
        if(!name.isNullOrBlank() && name!=InstrumentationRegistry.getInstrumentation().targetContext.packageName){pickerReady=true;break}
        Thread.sleep(100)
      }
      assertTrue("System file picker did not open",pickerReady)
      device.pressBack();ready(scenario,"window.__picker==='ok'")
      // Edit through the actual UI so lifecycle flushing contains the same unsaved project.
      js(scenario,"""const title=document.querySelector('#project-name');title.value='Android 原生草稿恢复';title.dispatchEvent(new Event('input',{bubbles:true}));true""")
      ready(scenario,"window.XuXian.snapshot().title==='Android 原生草稿恢复'")
      js(scenario,"""window.__draftTest='pending';(async()=>{
        const rpc=window.__TAURI_INTERNALS__.invoke;
        const initial=await rpc('mobile_command',{endpoint:'mobile/read-draft',body:{}});
        const project=window.XuXian.snapshot();project.title='Android 原生草稿恢复';
        const body={epoch:initial.epoch,sequence:2,project,dirty:true,sourceName:'',view:{type:'board'},savedAt:new Date().toISOString()};
        await rpc('mobile_command',{endpoint:'mobile/save-draft',body});
        await rpc('mobile_command',{endpoint:'mobile/save-draft',body:{...body,sequence:1,project:{...project,title:'stale'}}});
        const next=await rpc('mobile_command',{endpoint:'mobile/read-draft',body:{}});
        if(next.draft.project.title!==project.title)throw Error('older write replaced latest');
        await rpc('mobile_command',{endpoint:'mobile/save-draft',body:{...body,sequence:100,project:{...project,title:'old-session'}}});
        await rpc('mobile_command',{endpoint:'mobile/save-draft',body:{...body,epoch:next.epoch,sequence:1}});
        window.__draftTest='ok';
      })().catch(e=>window.__draftTest='error:'+e.message);true""")
      ready(scenario,"window.__draftTest==='ok'")
      scenario.recreate()
      ready(scenario,"window.XuXian && window.XuXian.snapshot().title==='Android 原生草稿恢复'")
      js(scenario,"""window.__background=false;window.__TAURI_INTERNALS__.invoke('mobile_command',{endpoint:'mobile/background',body:{}}).then(r=>window.__background=r.backgrounded);true""")
      ready(scenario,"window.__background===true")
    } finally {
      // Do not destroy Tao's final Activity inside the instrumentation process: its event loop
      // intentionally calls process::exit. The runner reports results, then Android cleans up.
      scenario.onActivity { it.moveTaskToBack(true) }
    }
  }
}
