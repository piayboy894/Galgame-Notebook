package io.github.piayboy894.xuxian

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import android.graphics.Color
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(statusBarStyle=SystemBarStyle.light(Color.TRANSPARENT,Color.TRANSPARENT), navigationBarStyle=SystemBarStyle.light(Color.TRANSPARENT,Color.TRANSPARENT))
    super.onCreate(savedInstanceState)
    val content=findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view,insets ->
      val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime=insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left,bars.top,bars.right,maxOf(bars.bottom,ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }
}
