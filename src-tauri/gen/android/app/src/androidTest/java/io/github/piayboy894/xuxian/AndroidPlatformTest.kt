package io.github.piayboy894.xuxian

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
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
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      ready(scenario,"window.XuXian && document.querySelector('.library-open')")
      assertEquals("true",js(scenario,"window.__XUXIAN_ANDROID__===true"))
      // This round trip exercises Rust -> Kotlin plugin registration and the system document picker.
      js(scenario,"""window.__picker='pending';window.__TAURI_INTERNALS__.invoke('mobile_command',{endpoint:'mobile/import',body:{}}).then(r=>window.__picker=r.cancelled?'ok':'selected').catch(e=>window.__picker='error');true""")
      val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
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
    }
  }
}
