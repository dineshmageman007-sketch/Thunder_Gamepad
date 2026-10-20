package com.padlink.app

import android.annotation.SuppressLint
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.MotionEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory
import kotlin.concurrent.thread

/**
 * Thunder Gamepad host activity. The whole app (UI + input logic) lives in assets/www and runs inside this WebView.
 * Kotlin only provides what a web page cannot: the raw TCP/WebSocket link to the laptop, LAN discovery,
 * vibration, immersive mode, keep-awake and file import/export. JS talks to it through `NativeBridge`;
 * Kotlin talks back by calling `window.Native.onMessage(<json string>)`.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var ws: WebSocket? = null
    private var pendingExport = ""
    private var wifiLock: WifiManager.WifiLock? = null
    private var lastRumbleAt = 0L

    /** TCP_NODELAY on every socket: tiny input messages must never wait for Nagle's algorithm. */
    private class NoDelayFactory : SocketFactory() {
        private val d: SocketFactory = SocketFactory.getDefault()
        private fun t(s: Socket): Socket { s.tcpNoDelay = true; return s }
        override fun createSocket(): Socket = t(d.createSocket())
        override fun createSocket(host: String, port: Int): Socket = t(d.createSocket(host, port))
        override fun createSocket(host: String, port: Int, la: InetAddress, lp: Int): Socket = t(d.createSocket(host, port, la, lp))
        override fun createSocket(host: InetAddress, port: Int): Socket = t(d.createSocket(host, port))
        override fun createSocket(a: InetAddress, port: Int, la: InetAddress, lp: Int): Socket = t(d.createSocket(a, port, la, lp))
    }

    /** Keep the Wi-Fi radio awake while connected (Wi-Fi power-save adds 50-200 ms bursts of lag to small packets). */
    private fun lockWifi(on: Boolean) {
        try {
            if (on) {
                if (wifiLock == null) {
                    val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                    @Suppress("DEPRECATION")
                    val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
                    wifiLock = wm.createWifiLock(mode, "ThunderGamepad").apply { setReferenceCounted(false) }
                }
                if (wifiLock?.isHeld == false) wifiLock?.acquire()
            } else if (wifiLock?.isHeld == true) {
                wifiLock?.release()
            }
        } catch (e: Exception) { }
    }

    private val http = OkHttpClient.Builder()
        .socketFactory(NoDelayFactory())
        .pingInterval(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val vibrator: Vibrator by lazy {
        if (Build.VERSION.SDK_INT >= 31) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    /** Real file name ("Windows.json") from the file picker; falls back to the last part of the path. */
    private fun displayName(uri: android.net.Uri): String {
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) { val n = c.getString(0); if (!n.isNullOrBlank()) return n }
            }
        } catch (_: Exception) {}
        return (uri.lastPathSegment ?: "layout").substringAfterLast('/').substringAfterLast(':')
    }

    private val importLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: ""
            toJs(JSONObject().put("t", "imported").put("name", displayName(uri)).put("text", text).toString())
        } catch (e: Exception) {
            toJs(JSONObject().put("t", "imported").put("error", e.message ?: "read failed").toString())
        }
    }

    private val exportLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@registerForActivityResult
        val ok = try {
            contentResolver.openOutputStream(uri)?.use { it.write(pendingExport.toByteArray()) }
            true
        } catch (e: Exception) { false }
        toJs(JSONObject().put("t", "exported").put("ok", ok).toString())
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        applyImmersive(true)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(0xFF0E1014.toInt())
            overScrollMode = WebView.OVER_SCROLL_NEVER
            isLongClickable = false
            isHapticFeedbackEnabled = false
            // Touch samples reach the page as they happen instead of being batched once per screen frame
            setOnTouchListener { v, ev ->
                if (ev.actionMasked == MotionEvent.ACTION_DOWN) v.requestUnbufferedDispatch(ev)
                false
            }
            // keep the page's renderer process at high priority, like a foreground browser tab
            setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            setOnLongClickListener { true }
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW   // page is https://appassets..., the PC socket is ws://
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportZoom(false)
            addJavascriptInterface(Bridge(), "NativeBridge")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
            }
            loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        }
        setContentView(web)
        requestMaxRefresh()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.Native&&window.Native.onBack)?window.Native.onBack():false") { r ->
                    if (r != "true") finish()
                }
            }
        })
    }

    /* A WebView does not ask for a high refresh rate by itself (Chrome does), so touch + drawing can end up at 60 Hz.
       Ask for the fastest display mode at the current resolution (e.g. 144 Hz). Harmless if the phone has only one mode. */
    private fun requestMaxRefresh() {
        try {
            @Suppress("DEPRECATION")
            val d = (if (Build.VERSION.SDK_INT >= 30) display else windowManager.defaultDisplay) ?: return
            val cur = d.mode
            var best = cur
            for (m in d.supportedModes) {
                if (m.physicalWidth == cur.physicalWidth && m.physicalHeight == cur.physicalHeight && m.refreshRate > best.refreshRate) best = m
            }
            val lp = window.attributes
            lp.preferredDisplayModeId = best.modeId
            lp.preferredRefreshRate = best.refreshRate
            window.attributes = lp
        } catch (e: Exception) { /* not supported: ignore */ }
    }

    private fun applyImmersive(on: Boolean) {
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (on) c.hide(WindowInsetsCompat.Type.systemBars()) else c.show(WindowInsetsCompat.Type.systemBars())
    }

    private fun toJs(json: String) {
        val q = JSONObject.quote(json)
        runOnUiThread { web.evaluateJavascript("window.Native&&window.Native.onMessage($q)", null) }
    }

    private fun link(state: String, err: String? = null) =
        toJs(JSONObject().put("t", "link").put("state", state).put("err", err ?: "").toString())

    override fun onResume() {
        super.onResume()
        requestMaxRefresh()
        if (::web.isInitialized) web.evaluateJavascript("window.Native&&window.Native.onResume&&window.Native.onResume()", null)
    }

    override fun onDestroy() {
        lockWifi(false)
        ws?.cancel()
        http.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    inner class Bridge {
        @JavascriptInterface
        fun connect(host: String, port: Int, code: String, pad: String) {
            disconnect()
            lockWifi(true)
            link("connecting")
            val req = try {
                Request.Builder().url("ws://$host:$port/ws").build()
            } catch (e: Exception) { link("failed", "bad address"); return }
            ws = http.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(
                        JSONObject().put("t", "hello").put("code", code).put("pad", pad)
                            .put("name", Build.MODEL).toString()
                    )
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text.contains("\"rumble\"")) {   // games can fire rumble hundreds of times a second: don't flood the WebView
                        val now = System.currentTimeMillis()
                        val stop = text.replace(" ", "").let { it.contains("\"l\":0") && it.contains("\"s\":0") }
                        if (!stop && now - lastRumbleAt < 60) return
                        lastRumbleAt = now
                    }
                    toJs(text)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (webSocket === ws) link("closed")
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (webSocket === ws) link("failed", t.message)
                }
            })
        }

        @JavascriptInterface
        fun keepWifi(on: Boolean) = lockWifi(on)

        @JavascriptInterface
        fun disconnect() { ws?.close(1000, "bye"); ws = null; lockWifi(false) }

        private var pdx = 0
        private var pdy = 0

        /** Mouse-move deltas are merged while the socket is backed up, so lag can never build up behind your finger. */
        @JavascriptInterface
        @Synchronized
        fun send(json: String) {
            val w = ws ?: return
            if (json.startsWith("{\"t\":\"mmove\"")) {
                try {
                    val o = JSONObject(json)
                    pdx += o.optInt("dx"); pdy += o.optInt("dy")
                } catch (e: Exception) { return }
                if (w.queueSize() > 4096L) return
                w.send("{\"t\":\"mmove\",\"dx\":$pdx,\"dy\":$pdy}")
                pdx = 0; pdy = 0
            } else {
                w.send(json)
            }
        }

        @JavascriptInterface
        fun vibrate(ms: Long, amp: Int) {
            if (!vibrator.hasVibrator()) return
            vibrator.vibrate(VibrationEffect.createOneShot(ms.coerceIn(1, 2000), amp.coerceIn(1, 255)))
        }

        @JavascriptInterface
        fun keepAwake(on: Boolean) = runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        @JavascriptInterface
        fun showKeyboard() = runOnUiThread {   // WebView won't raise the IME for focus() called outside a click, so force it
            web.requestFocus()
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            imm.showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
        }

        @JavascriptInterface
        fun hideKeyboard() = runOnUiThread {   // give the screen back to the game: hide IME, drop text focus, re-hide system bars
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            imm.hideSoftInputFromWindow(web.windowToken, 0)
            web.clearFocus()
            applyImmersive(true)
        }

        @JavascriptInterface
        fun immersive(on: Boolean) = runOnUiThread { applyImmersive(on) }

        @JavascriptInterface
        fun importFile() = runOnUiThread { importLauncher.launch("*/*") }

        @JavascriptInterface
        fun exportFile(name: String, text: String) = runOnUiThread {
            pendingExport = text
            exportLauncher.launch(name)
        }

        @JavascriptInterface
        fun exitApp() = runOnUiThread { finish() }

        /** Broadcast "PADLINK?" on the LAN; receivers answer with a small JSON card. Result arrives as {t:"found"}. */
        @JavascriptInterface
        fun discover() {
            thread(isDaemon = true) {
                val found = JSONArray()
                try {
                    val targets = linkedSetOf<InetAddress>(InetAddress.getByName("255.255.255.255"))
                    NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { ni ->
                        if (ni.isUp && !ni.isLoopback) ni.interfaceAddresses.forEach { ia -> ia.broadcast?.let { targets.add(it) } }
                    }
                    DatagramSocket().use { s ->
                        s.broadcast = true
                        s.soTimeout = 400
                        val msg = "PADLINK?".toByteArray()
                        targets.forEach { try { s.send(DatagramPacket(msg, msg.size, it, 8767)) } catch (_: Exception) {} }
                        val end = System.currentTimeMillis() + 1500
                        val seen = HashSet<String>()
                        val buf = ByteArray(1024)
                        while (System.currentTimeMillis() < end) {
                            try {
                                val p = DatagramPacket(buf, buf.size)
                                s.receive(p)
                                val o = JSONObject(String(p.data, 0, p.length))
                                o.put("host", p.address.hostAddress)
                                if (seen.add(o.getString("host") + ":" + o.optInt("port"))) found.put(o)
                            } catch (_: SocketTimeoutException) {
                            } catch (_: Exception) {
                            }
                        }
                    }
                } catch (_: Exception) {
                }
                toJs(JSONObject().put("t", "found").put("list", found).toString())
            }
        }
    }
}
