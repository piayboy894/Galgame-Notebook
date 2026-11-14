package io.github.piayboy894.xuxian

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

@InvokeArg class SecretArgs { lateinit var key: String; var value: String = "" }
@InvokeArg class ExportArgs { lateinit var name: String; lateinit var text: String }

/** Only ciphertext is stored in preferences. The AES key stays in Android Keystore. */
class TokenVault(context: Context) {
  private val preferences = context.getSharedPreferences("xuxian-vault", Context.MODE_PRIVATE)
  private val alias = "xuxian.github.aes.v1"
  private fun key(create: Boolean): SecretKey? {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    if (!create) return null
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256).setUserAuthenticationRequired(false).build())
    }.generateKey()
  }
  fun get(name: String): String? {
    val encoded = preferences.getString(name, null) ?: return null
    val secret = key(false) ?: return null
    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
    require(bytes.size > 28)
    return Cipher.getInstance("AES/GCM/NoPadding").run {
      init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
      doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
    }
  }
  fun set(name: String, value: String) {
    val encrypted = Cipher.getInstance("AES/GCM/NoPadding").run {
      init(Cipher.ENCRYPT_MODE, key(true)); require(iv.size == 12)
      iv + doFinal(value.toByteArray(Charsets.UTF_8))
    }
    check(preferences.edit().putString(name, Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
  }
  fun delete(name: String) { check(preferences.edit().remove(name).commit()) }
}

@TauriPlugin
class MobilePlugin(private val activity: Activity): Plugin(activity) {
  private val worker = Executors.newSingleThreadExecutor()
  private val vault = TokenVault(activity)
  private var exporting: ExportArgs? = null
  private var fileOperation = false

  override fun load(webView: WebView) {
    // Window dimensions, including the on-screen keyboard, drive the same CSS on DeX and touch devices.
    webView.settings.setSupportZoom(false)
    webView.settings.displayZoomControls = false
  }
  private fun secret(invoke: Invoke, work: (SecretArgs) -> JSObject) {
    worker.execute {
      try {
        val args=invoke.parseArgs(SecretArgs::class.java)
        require(args.key.matches(Regex("[a-f0-9]{64}")))
        invoke.resolve(work(args))
      } catch (_: Exception) { invoke.reject("Android 安全凭据操作失败，请重新填写令牌") }
    }
  }
  @Command fun secretGet(invoke: Invoke) = secret(invoke) { args ->
    // A device restore can copy ciphertext without its Keystore key. Permit reconfiguration.
    val value = try { vault.get(args.key) } catch (_: Exception) { null }
    JSObject().put("value", value ?: JSONObject.NULL)
  }
  @Command fun secretSet(invoke: Invoke) = secret(invoke) { args ->
    require(args.value.length in 1..4096); vault.set(args.key,args.value); JSObject().put("saved",true)
  }
  @Command fun secretDelete(invoke: Invoke) = secret(invoke) { args ->
    vault.delete(args.key); JSObject().put("deleted",true)
  }
  @Command fun background(invoke: Invoke) { activity.moveTaskToBack(true); invoke.resolve() }
  @Command fun installUpdate(invoke: Invoke) {
    try {
      if(!activity.packageManager.canRequestPackageInstalls()) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:"+activity.packageName)))
        invoke.resolve(JSObject().put("permissionRequired",true));return
      }
      val file=File(activity.cacheDir,"updates/Xuxian-update.apk")
      require(file.isFile)
      val uri=FileProvider.getUriForFile(activity,activity.packageName+".fileprovider",file)
      activity.startActivity(Intent(Intent.ACTION_VIEW).apply { setDataAndType(uri,"application/vnd.android.package-archive");addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) })
      invoke.resolve(JSObject().put("opened",true))
    } catch (_: Exception) { invoke.reject("无法打开系统安装器，请通过下载页面安装新版") }
  }

  @Command fun importProject(invoke: Invoke) {
    if(fileOperation) { invoke.reject("已有文件选择操作进行中"); return }
    fileOperation=true
    try {
      val intent=Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE); type="*/*"
        putExtra(Intent.EXTRA_MIME_TYPES,arrayOf("application/json","text/plain","application/octet-stream"))
      }
      startActivityForResult(invoke,intent,"importResult")
    } catch (_: Exception) { fileOperation=false; invoke.reject("无法打开系统文件选择器") }
  }
  @ActivityCallback fun importResult(invoke: Invoke,result: ActivityResult) {
    fileOperation=false
    val uri=result.data?.data
    if(result.resultCode!=Activity.RESULT_OK || uri==null) { invoke.resolve(JSObject().put("cancelled",true)); return }
    worker.execute {
      try {
        var name="剧本.story.json"
        activity.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { cursor ->
          if(cursor.moveToFirst()) name=cursor.getString(0) ?: name
        }
        val output=ByteArrayOutputStream()
        activity.contentResolver.openInputStream(uri)!!.use { input ->
          val buffer=ByteArray(8192)
          while(true) { val count=input.read(buffer); if(count<0) break; require(output.size()+count<=25*1024*1024); output.write(buffer,0,count) }
        }
        val text=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString()
        invoke.resolve(JSObject().put("name",name).put("text",text))
      } catch (_: Exception) { invoke.reject("无法读取剧本，请选择不超过 25 MB 的 UTF-8 JSON 文件") }
    }
  }
  @Command fun exportFile(invoke: Invoke) {
    if(fileOperation) { invoke.reject("已有文件选择操作进行中"); return }
    try {
      val args=invoke.parseArgs(ExportArgs::class.java)
      require(args.text.toByteArray(Charsets.UTF_8).size<=50*1024*1024)
      exporting=args; fileOperation=true
      val intent=Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE); type=if(args.name.endsWith(".json")) "application/json" else "text/plain"
        putExtra(Intent.EXTRA_TITLE,args.name.substringAfterLast('/').substringAfterLast('\\'))
      }
      startActivityForResult(invoke,intent,"exportResult")
    } catch (_: Exception) { exporting=null; fileOperation=false; invoke.reject("无法打开系统保存位置") }
  }
  @ActivityCallback fun exportResult(invoke: Invoke,result: ActivityResult) {
    val args=exporting; exporting=null; fileOperation=false
    val uri=result.data?.data
    if(result.resultCode!=Activity.RESULT_OK || uri==null || args==null) { invoke.resolve(JSObject().put("cancelled",true)); return }
    worker.execute {
      try {
        activity.contentResolver.openOutputStream(uri,"wt")!!.use { it.write(args.text.toByteArray(Charsets.UTF_8)) }
        invoke.resolve(JSObject().put("saved",true))
      } catch (_: Exception) { invoke.reject("导出失败，本地项目已保留") }
    }
  }
}
