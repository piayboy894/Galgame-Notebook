package io.github.piayboy894.xuxian

import android.os.Bundle
import android.content.res.Configuration
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.view.Menu
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var lastInputState: String? = null
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(statusBarStyle=SystemBarStyle.light(Color.TRANSPARENT,Color.TRANSPARENT), navigationBarStyle=SystemBarStyle.light(Color.TRANSPARENT,Color.TRANSPARENT))
    super.onCreate(savedInstanceState)
    val content=findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view,insets ->
      val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime=insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left,bars.top,bars.right,maxOf(bars.bottom,ime.bottom))
      announceInputState(insets)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }
  private fun browser(view: View): WebView? {
    if(view is WebView)return view
    if(view is ViewGroup)for(index in 0 until view.childCount)browser(view.getChildAt(index))?.let{return it}
    return null
  }
  private fun announceInputState(insets: WindowInsetsCompat? = ViewCompat.getRootWindowInsets(window.decorView)) {
    val webView=browser(findViewById(android.R.id.content)) ?: return
    val state=deviceInputState(this,insets).toString()
    if(lastInputState==state)return
    lastInputState=state
    webView.post {
      webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('xuxian:input-state',{detail:$state}));",null)
    }
  }
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    announceInputState()
  }
  override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>, menu: Menu?, deviceId: Int) {
    super.onProvideKeyboardShortcuts(data,menu,deviceId)
    data.add(KeyboardShortcutGroup("叙线",listOf(
      KeyboardShortcutInfo("保存剧本",KeyEvent.KEYCODE_S,KeyEvent.META_CTRL_ON),
      KeyboardShortcutInfo("打开源文件",KeyEvent.KEYCODE_O,KeyEvent.META_CTRL_ON),
      KeyboardShortcutInfo("搜索",KeyEvent.KEYCODE_K,KeyEvent.META_CTRL_ON),
      KeyboardShortcutInfo("选中行建组",KeyEvent.KEYCODE_G,KeyEvent.META_CTRL_ON),
      KeyboardShortcutInfo("撤销",KeyEvent.KEYCODE_Z,KeyEvent.META_CTRL_ON),
      KeyboardShortcutInfo("重做",KeyEvent.KEYCODE_Z,KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON),
      KeyboardShortcutInfo("新增对白",KeyEvent.KEYCODE_ENTER,KeyEvent.META_ALT_ON)
    )))
  }
}
