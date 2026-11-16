package io.github.quillharbor.roleleaf.test;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.DocumentsContract;
import android.text.TextUtils;
import android.util.Base64;
import android.util.LruCache;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Native capabilities are only exposed to the bundled UI, never to source/auth pages. */
public class MainActivity extends Activity {
    private static final String LOCAL = "https://appassets.androidplatform.net";
    private static final int SAVE_DOCUMENT = 51, OPEN_DOCUMENT = 52, PICK_ZIP_FOLDER = 53, CHUNK = 131072, ZIP_LIMIT = 129 * 1024 * 1024;
    private static final int AVATAR_LIMIT = 2 * 1024 * 1024;
    private static final Set<String> MEDIA_HOSTS = set("img.tipsy.chat", "characterai.io");
    private static final Set<String> AVATAR_TYPES = set("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif");
    private final LruCache<String, Avatar> avatars = new LruCache<String, Avatar>(8 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Avatar value) { return value.bytes.length; }
    };
    private static final class Avatar {
        final String type;
        final byte[] bytes;
        Avatar(String type, byte[] bytes) { this.type = type; this.bytes = bytes; }
    }
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService downloads = Executors.newFixedThreadPool(2);
    private final Map<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
    private static final class Capture {
        final String request;
        final WebView view;
        Capture(String request, WebView view) { this.request = request; this.view = view; }
    }
    private final Map<String, Capture> captures = new HashMap<>();
    private final Map<String, WebView> siteViews = new HashMap<>();
    private WebView panel, source, popup, worker;
    private FrameLayout content;
    private LinearLayout browser;
    private LinearLayout platforms;
    private Button tipsyButton, caiButton, exportButton;
    private Button browserBack, browserReload, openZipButton, languageButton;
    private static final String[] UI_LOCALES = {"en", "ar", "ja", "ko", "zh-Hant"};
    private static final String[] UI_LANGUAGE_NAMES = {"English", "العربية", "日本語", "한국어", "繁體中文"};
    private String uiLanguage = "en";
    private TextView browserHost;
    private String platform = "tipsy", pendingSave, pendingReload, pendingFolder;
    private boolean busy, pickerOpen, panelReady, supported, destroyed;
    private File zip;
    private OutputStream zipStream;
    private long zipSize, zipExpected;
    private String zipName;
    private Uri savedUri, zipFolder;

    private static Set<String> set(String... values) { return new HashSet<>(Arrays.asList(values)); }
    private static void copy(InputStream input, OutputStream out) throws IOException {
        byte[] buffer = new byte[32768]; int n; while ((n = input.read(buffer)) != -1) out.write(buffer, 0, n);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private String origin() { return platform.equals("tipsy") ? "https://tipsy.chat" : "https://character.ai"; }
    private String startUrl() { return origin() + (platform.equals("tipsy") ? "/chat/recent" : ""); }
    private JSONObject obj(Object... pairs) {
        JSONObject result = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]); }
        catch (Exception e) { throw new IllegalArgumentException(e); }
        return result;
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private Button button(String text, Runnable action) {
        Button button = new Button(this); button.setText(text); button.setAllCaps(false); button.setTextSize(13);
        button.setMinWidth(0); button.setMinimumWidth(0); button.setPadding(dp(8),0,dp(8),0);
        button.setTextColor(Color.rgb(233,225,255)); paintButton(button,false);
        button.setOnClickListener(v -> action.run()); return button;
    }
    private void paintButton(Button button, boolean selected) {
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.parseColor(selected?"#40364F":"#20222F")); bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1),Color.parseColor(selected?"#65517F":"#303244")); button.setBackground(bg);
    }
    private LinearLayout row() { LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); row.setPadding(dp(8),dp(6),dp(8),dp(6)); return row; }
    private void equal(LinearLayout row, View view) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0,dp(44),1); params.setMargins(dp(4),0,dp(4),0); row.addView(view,params);
    }

    private String uiText(int id) {
        android.content.res.Configuration config = new android.content.res.Configuration(getResources().getConfiguration());
        config.setLocale(Locale.forLanguageTag(uiLanguage));
        return createConfigurationContext(config).getString(id);
    }

    private String panelUrl() {
        return LOCAL + "/assets/index.html?lang=" + uiLanguage;
    }

    private void updateLanguageControls() {
        int selected = Arrays.asList(UI_LOCALES).indexOf(uiLanguage);
        languageButton.setText(UI_LANGUAGE_NAMES[selected]);
        languageButton.setContentDescription(uiText(R.string.ui_language));
        openZipButton.setText(uiText(R.string.ui_open_zip));
        exportButton.setText(uiText(R.string.ui_batch));
        browserBack.setContentDescription(uiText(R.string.browser_back));
        browserReload.setContentDescription(uiText(R.string.browser_reload));
        browser.setLayoutDirection("ar".equals(uiLanguage) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR);
        browserBack.setText("ar".equals(uiLanguage) ? "→" : "←");
        browserHost.setTextDirection(View.TEXT_DIRECTION_LTR);
    }

    private void chooseLanguage() {
        if (pickerOpen || busy) return;
        new android.app.AlertDialog.Builder(this).setTitle(uiText(R.string.ui_language))
                .setSingleChoiceItems(UI_LANGUAGE_NAMES, Arrays.asList(UI_LOCALES).indexOf(uiLanguage), (dialog, index) -> {
                    dialog.dismiss();
                    if (UI_LOCALES[index].equals(uiLanguage)) return;
                    uiLanguage = UI_LOCALES[index];
                    getPreferences(MODE_PRIVATE).edit().putString("language", uiLanguage).apply();
                    updateLanguageControls();
                    panelReady = false;
                    panel.loadUrl(panelUrl());
                }).show();
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String preferredLanguage = getPreferences(MODE_PRIVATE).getString("language", "en");
        if (Arrays.asList(UI_LOCALES).contains(preferredLanguage)) uiLanguage = preferredLanguage;
        getWindow().setNavigationBarColor(Color.rgb(17,19,25));
        if (android.os.Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        // Local test APK only. Release builds never expose WebView debugging.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (!supported) {
            android.widget.TextView message = new android.widget.TextView(this);
            message.setText(uiText(R.string.ui_update_webview));
            message.setPadding(dp(24),dp(60),dp(24),dp(24)); setContentView(message); return;
        }
        File[] old = getCacheDir().listFiles((dir, name) -> name.startsWith("export-") || name.startsWith("image-"));
        if (old != null) for (File file : old) file.delete();
        FrameLayout root = new FrameLayout(this);
        browser = new LinearLayout(this); browser.setOrientation(LinearLayout.VERTICAL);
        root.addView(browser, new FrameLayout.LayoutParams(-1,-1));
        root.setBackgroundColor(Color.rgb(17,19,25));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        platforms = row();
        tipsyButton = button("Tipsy", () -> switchSite("tipsy")); caiButton = button("Character.AI", () -> switchSite("character_ai"));
        equal(platforms,tipsyButton); equal(platforms,caiButton);
        languageButton = button("", this::chooseLanguage);
        equal(platforms,languageButton);
        LinearLayout toolbar = row();
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        browserBack = navigationButton("←", R.string.browser_back, this::goBackInBrowser);
        toolbar.addView(browserBack, new LinearLayout.LayoutParams(dp(44),dp(44)));
        browserHost = new TextView(this);
        browserHost.setTextSize(13);
        browserHost.setTextColor(Color.rgb(233,225,255));
        browserHost.setSingleLine(true);
        browserHost.setEllipsize(TextUtils.TruncateAt.END);
        browserHost.setGravity(android.view.Gravity.CENTER_VERTICAL);
        browserHost.setPadding(dp(8),0,dp(6),0);
        toolbar.addView(browserHost, new LinearLayout.LayoutParams(0,dp(44),1));
        browserReload = navigationButton("↻", R.string.browser_reload, this::reloadBrowser);
        LinearLayout.LayoutParams reloadParams = new LinearLayout.LayoutParams(dp(44),dp(44));
        reloadParams.setMarginEnd(dp(6));
        toolbar.addView(browserReload,reloadParams);
        openZipButton = button("", this::chooseZip);
        LinearLayout.LayoutParams openParams = new LinearLayout.LayoutParams(-2,dp(44));
        openParams.setMarginEnd(dp(6));
        toolbar.addView(openZipButton,openParams);
        exportButton = button("", this::openPicker);
        paintButton(exportButton,true);
        toolbar.addView(exportButton,new LinearLayout.LayoutParams(-2,dp(44)));
        browser.addView(toolbar);
        content = new FrameLayout(this); browser.addView(content, new LinearLayout.LayoutParams(-1,0,1));
        browser.addView(platforms);
        panel = createPanel(); panel.setVisibility(View.GONE);
        root.addView(panel, new FrameLayout.LayoutParams(-1,-1)); setContentView(root);
        root.post(() -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.view.WindowInsetsController controller = root.getWindowInsetsController();
                if (controller != null) controller.setSystemBarsAppearance(0,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        });
        updateLanguageControls();
        panel.loadUrl(panelUrl()); showSite();
    }

    private Button navigationButton(String symbol, int description, Runnable action) {
        Button button = button(symbol, action);
        button.setTextSize(20);
        button.setContentDescription(uiText(description));
        button.setPadding(0,0,0,0);
        return button;
    }

    private WebView activeBrowserPage() { return popup != null ? popup : source; }

    private boolean goBackInBrowser() {
        if (busy || pickerOpen) return false;
        WebView page = activeBrowserPage();
        if (page != null && page.canGoBack()) { page.goBack(); return true; }
        if (popup == null) return false;
        closePopup();
        return true;
    }

    private void reloadBrowser() {
        WebView page = activeBrowserPage();
        if (!busy && !pickerOpen && page != null) page.reload();
    }

    private void updateBrowserToolbar() {
        WebView page = activeBrowserPage();
        if (destroyed || browserHost == null || page == null) return;
        String url = page.getUrl();
        String host = url == null ? null : Uri.parse(url).getHost();
        browserHost.setText(host == null ? Uri.parse(origin()).getHost() : host);
        boolean canGoBack = popup != null || page.canGoBack();
        browserBack.setEnabled(canGoBack);
        browserBack.setAlpha(canGoBack ? 1f : 0.45f);
    }

    private void settings(WebView web) {
        WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true); s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false); web.setBackgroundColor(Color.rgb(20,22,32));
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
    }
    private WebView createPanel() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) throw new IllegalStateException("Update Android System WebView");
        WebView web = new WebView(this); settings(web);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("GET".equals(request.getMethod()) && LOCAL.equals(uri.getScheme() + "://" + uri.getAuthority())
                        && "/avatar".equals(uri.getPath())) {
                    Avatar avatar = loadAvatar(uri.getQueryParameter("url"));
                    if (avatar != null) return new WebResourceResponse(avatar.type, null, new ByteArrayInputStream(avatar.bytes));
                }
                WebResourceResponse response = loader.shouldInterceptRequest(uri);
                return response != null ? response : new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public void onPageFinished(WebView view, String url) {
                panelReady = panelUrl().equals(url);
                if (panelReady && pickerOpen) requestPicker();
            }
        });
        WebViewCompat.addWebMessageListener(web,"NativeApp",set(LOCAL),(view,message,sourceOrigin,mainFrame,reply) -> {
            if (!mainFrame || !LOCAL.equals(sourceOrigin.toString()) || destroyed) return;
            String raw = message.getData(); if (raw == null || raw.length() > 250000) return;
            try { JSONObject req = new JSONObject(raw); dispatch(req.getString("id"),req.getString("method"),req.optJSONObject("params")); }
            catch (Exception e) { /* Malformed bridge input has no native effect. */ }
        });
        return web;
    }
    private static URL mediaUrl(String raw) throws IOException {
        URL url = new URL(raw);
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null
                || (url.getPort() != -1 && url.getPort() != 443) || !MEDIA_HOSTS.contains(url.getHost())) {
            throw new IOException("Media host is not allowed");
        }
        return url;
    }
    private Avatar loadAvatar(String raw) {
        if (raw == null) return null;
        Avatar cached = avatars.get(raw);
        if (cached != null) return cached;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) mediaUrl(raw).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            if (connection.getResponseCode() != 200 || connection.getContentLength() > AVATAR_LIMIT) return null;
            String type = connection.getContentType();
            if (type == null || !AVATAR_TYPES.contains(type)) return null;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > AVATAR_LIMIT) return null;
                    bytes.write(buffer, 0, count);
                }
                Avatar avatar = new Avatar(type, bytes.toByteArray());
                avatars.put(raw, avatar);
                return avatar;
            }
        } catch (IOException e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
    private boolean allowed(String raw) {
        try {
            Uri uri = Uri.parse(raw); String host = uri.getHost();
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
            return set("tipsy.chat","auth2.tipsy.chat","character.ai","auth.character.ai","policies.character.ai","accounts.google.com").contains(host)
                    || "apple.com".equals(host) || (host != null && host.endsWith(".apple.com"));
        } catch (Exception e) { return false; }
    }
    private WebView createSource(boolean capture) {
        WebView web = new WebView(this); settings(web);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                if (pickerOpen && view == source) { toast(uiText(R.string.ui_hold_page)); return true; }
                if (allowed(request.getUrl().toString())) return false;
                toast(uiText(R.string.ui_outside_link)); return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                failCaptures(view, "The page changed. Try again.");
            }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                if (view == activeBrowserPage()) updateBrowserToolbar();
            }
            @Override public void onPageFinished(WebView view,String url) {
                CookieManager.getInstance().flush();
                if (view == activeBrowserPage()) updateBrowserToolbar();
                if (view == worker && pendingReload != null && url.equals(view.getUrl())) {
                    String id = pendingReload; pendingReload = null; respond(id,true);
                }
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,android.webkit.WebResourceError error) {
                if (request.isForMainFrame() && (view == source || view == worker || view == popup)) {
                    if (view != worker) toast(uiText(R.string.ui_load_failed));
                    if (view == worker && pendingReload != null) { reject(pendingReload,"Page failed to load. Check your connection."); pendingReload=null; }
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                if (!userGesture || pickerOpen || view != source || popup != null) return false;
                popup = createSource(false); content.addView(popup,new FrameLayout.LayoutParams(-1,-1));
                ((WebView.WebViewTransport)result.obj).setWebView(popup); result.sendToTarget();
                updateBrowserToolbar();
                return true;
            }
            @Override public void onCloseWindow(WebView view) { if (view == popup) { closePopup(); source.reload(); } }
        });
        if (capture) {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) throw new IllegalStateException("Update Android System WebView");
            Set<String> origins = set("https://tipsy.chat","https://character.ai");
            WebViewCompat.addWebMessageListener(web,"CaptureReply",origins,(view,message,sourceOrigin,mainFrame,reply) -> {
                if (!mainFrame || (view != source && view != worker) || !origin().equals(sourceOrigin.toString())) return;
                String raw = message.getData(); if (raw == null || raw.length() > 40 * 1024 * 1024) return;
                try {
                    JSONObject response = new JSONObject(raw); String key = response.getString("id");
                    Capture entry = captures.get(key);
                    if (entry != null && entry.view == view) {
                        captures.remove(key); respond(entry.request,response.opt("result"));
                    }
                } catch (Exception e) { /* Ignore uncorrelated site data. */ }
            });
            for (String site : origins) {
                boolean tipsy = site.contains("tipsy");
                String page = asset("shared/" + (tipsy ? "page.bundle.js" : "cai-page.bundle.js"));
                String bridge = asset("shared/" + (tipsy ? "bridge.bundle.js" : "cai-bridge.bundle.js"));
                String script = "(()=>{if(window!==top)return;const listeners=[];const chrome={runtime:{id:'android',onMessage:{addListener:f=>listeners.push(f)}}};\n"
                        + page + "\n;" + bridge + "\n;" + asset(tipsy ? "tipsy-list.js" : "cai-list.js") + "\n;window.__botAndroidRequest=(id,message)=>{let done=false;const reply=result=>{if(done)return;done=true;CaptureReply.postMessage(JSON.stringify({id,result}));};const pending=listeners.map(f=>f(message,{id:'android'},reply)).includes(true);if(!done&&!pending)reply({ok:false,reason:'unavailable'});};})();";
                WebViewCompat.addDocumentStartJavaScript(web,script,set(site));
            }
        }
        return web;
    }
    private String asset(String name) {
        try (InputStream input = getAssets().open(name)) { ByteArrayOutputStream out = new ByteArrayOutputStream(); copy(input,out); return out.toString("UTF-8"); }
        catch (Exception e) { throw new IllegalStateException("Export resources are missing",e); }
    }
    private void closePopup() {
        if (popup == null) return;
        content.removeView(popup);
        popup.destroy();
        popup = null;
        updateBrowserToolbar();
    }
    private void chooseZip() {
        Intent choose = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/zip");
        if (savedUri != null) choose.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,savedUri);
        try { startActivityForResult(choose,OPEN_DOCUMENT); }
        catch (android.content.ActivityNotFoundException e) { toast(uiText(R.string.ui_file_picker_failed)); }
    }
    private void viewZip(Uri uri) {
        Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri,"application/zip")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivity(view); }
        catch (android.content.ActivityNotFoundException e) {
            toast(uiText(R.string.ui_zip_no_handler));
        } catch (SecurityException e) {
            toast(uiText(R.string.ui_zip_unavailable));
        }
    }
    private void switchSite(String value) {
        if (pickerOpen || value.equals(platform)) return;
        closePopup(); source.setVisibility(View.GONE); platform = value; showSite();
    }
    private void showSite() {
        source = siteViews.get(platform);
        if (source == null) {
            source = createSource(true);
            if (platform.equals("tipsy")) {
                WebViewCompat.addDocumentStartJavaScript(source, asset("tipsy-viewport.js"), set("https://tipsy.chat"));
            }
            siteViews.put(platform, source);
            content.addView(source, new FrameLayout.LayoutParams(-1,-1));
            source.loadUrl(startUrl());
        }
        source.setVisibility(View.VISIBLE);
        paintButton(tipsyButton, platform.equals("tipsy"));
        paintButton(caiButton, platform.equals("character_ai"));
        tipsyButton.setSelected(platform.equals("tipsy"));
        caiButton.setSelected(platform.equals("character_ai"));
        updateBrowserToolbar();
    }
    private void openPicker() {
        if (pickerOpen || popup != null) return;
        pickerOpen = true;
        browser.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        panel.setVisibility(View.VISIBLE); panel.requestFocus();
        if (panelReady) requestPicker();
    }
    private void requestPicker() {
        panel.evaluateJavascript("window.openBatchPicker&&window.openBatchPicker()",null);
    }
    private void dismissPicker() throws IOException {
        if (busy || pendingSave != null) throw new IOException("Stop the export or wait for it to finish.");
        closeWorker();
        zipFolder = null;
        pickerOpen = false; panel.setVisibility(View.GONE);
        browser.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        exportButton.requestFocus();
    }
    private void openWorkerPage(String id, String url) throws IOException {
        openWorkerPage(id, url, false);
    }
    private void openWorkerPage(String id, String url, boolean listPage) throws IOException {
        if (!pickerOpen) throw new IOException("Open Batch export first");
        if (pendingReload != null) throw new IOException("The export page is loading");
        if (worker == null) {
            worker = createSource(true);
            worker.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            // Keep the page attached for the site's virtual scrolling during export.
            content.addView(worker, 0, new FrameLayout.LayoutParams(-1,-1));
        }
        // A mobile C.AI home omits Recent entirely. Only the hidden list page
        // uses a desktop viewport; the visible browser keeps its mobile layout.
        worker.setLayoutParams(new FrameLayout.LayoutParams(listPage ? dp(1100) : -1, -1));
        worker.getSettings().setUseWideViewPort(listPage);
        worker.getSettings().setLoadWithOverviewMode(listPage);
        pendingReload = id; worker.loadUrl(url);
        main.postDelayed(() -> {
            if (id.equals(pendingReload)) { pendingReload = null; reject(id,"Export page took too long to load"); }
        },35000);
    }
    private void closeWorker() {
        if (worker == null) return;
        if (pendingReload != null) { reject(pendingReload,"Export page closed"); pendingReload = null; }
        failCaptures(worker, "Export page closed");
        WebView old = worker; worker = null; content.removeView(old); old.destroy();
    }
    private void respond(String id,Object data) { reply(obj("id",id,"ok",true,"data",data == null?JSONObject.NULL:data)); }
    private void reject(String id,String error) { reply(obj("id",id,"ok",false,"error",error)); }
    private void reply(JSONObject response) {
        main.post(() -> { if (!destroyed && panel != null) panel.evaluateJavascript("window.nativeReply&&window.nativeReply(" + response + ")",null); });
    }
    private void failCaptures(WebView view, String reason) {
        captures.values().removeIf(entry -> {
            if (entry.view != view) return false;
            reject(entry.request,reason); return true;
        });
    }

    private void dispatch(String id,String method,JSONObject params) {
        JSONObject p = params == null ? new JSONObject() : params;
        try {
            switch (method) {
                case "current": {
                    WebView view = p.optBoolean("worker") ? worker : source;
                    if (view == null) throw new IOException("Export page is unavailable");
                    respond(id,obj("id",1,"platform",platform,"url",view.getUrl(),"title",view.getTitle())); break;
                }
                case "dismissPicker": dismissPicker(); respond(id,true); break;
                case "busy":
                    busy = p.getBoolean("value");
                    if (busy) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    respond(id,true); break;
                case "capture": capture(id,p.getJSONObject("message"),p.optBoolean("worker") ? worker : source); break;
                case "openRecent": openWorkerPage(id,startUrl()); break;
                case "openCaiList": {
                    String scope = p.optString("scope");
                    if (!platform.equals("character_ai") || !set("recent", "creator").contains(scope))
                        throw new IOException("Invalid list scope");
                    String url = p.optString("url", "");
                    if (!url.isEmpty() && (!scope.equals("creator") ||
                        !url.matches("https://character\\.ai/profile/[A-Za-z0-9_.-]{1,100}")))
                        throw new IOException("Invalid profile address");
                    openWorkerPage(id, url.isEmpty() ? origin() + "/" : url, true);
                    break;
                }
                case "closeWorker": closeWorker(); respond(id,true); break;
                case "openCreatorProfile":
                case "openCreatorWorker": {
                    String url = p.getString("url");
                    Uri page = Uri.parse(url);
                    String path = page.getPath();
                    boolean profile = path != null && (platform.equals("tipsy")
                        ? path.matches("(?i)/(?:[a-z]{2}(?:-[a-z]{2})?/)?profile/[0-9]{6,30}/?")
                        : path.matches("/profile(?:/[A-Za-z0-9_.-]{1,100})?/?"));
                    boolean editor = path != null && platform.equals("character_ai") && path.matches("/character/[A-Za-z0-9_-]{6,100}/edit/?");
                    if (!origin().equals(page.getScheme() + "://" + page.getEncodedAuthority()) ||
                        page.getEncodedQuery() != null || page.getEncodedFragment() != null ||
                        (!profile && (!editor || method.equals("openCreatorProfile")))) throw new IOException("Invalid creator page address");
                    if (method.equals("openCreatorProfile")) {
                        dismissPicker(); source.loadUrl(url); respond(id,true);
                    } else openWorkerPage(id,url);
                    break;
                }
                case "openChatPage": {
                    String url = p.getString("url");
                    Uri chat = Uri.parse(url);
                    String path = chat.getPath();
                    boolean valid = path != null && (platform.equals("tipsy") ? path.matches("/chat/[0-9]{6,30}/?")
                            : path.matches("/chat/[A-Za-z0-9_-]{6,100}/?"));
                    if (!valid || !origin().equals(chat.getScheme() + "://" + chat.getEncodedAuthority())) {
                        throw new IOException("Invalid chat address");
                    }
                    openWorkerPage(id,url); break;
                }
                case "imageDownload": download(id,p); break;
                case "imageRead": io.execute(() -> {
                    try (RandomAccessFile file = new RandomAccessFile(imageFile(p.getString("id")),"r")) {
                        long offset = p.getLong("offset"); if (offset < 0 || offset > file.length()) throw new IOException("Invalid image offset");
                        file.seek(offset); byte[] data = new byte[(int)Math.min(CHUNK,file.length()-offset)]; file.readFully(data);
                        respond(id,Base64.encodeToString(data,Base64.NO_WRAP));
                    } catch (Exception e) { reject(id,"Could not read the image"); }
                }); break;
                case "imageCancel": {
                    String key = p.getString("id"); HttpURLConnection connection = connections.remove(key);
                    downloads.execute(() -> { if (connection != null) connection.disconnect(); try { imageFile(key).delete(); } catch (Exception ignored) {} });
                    respond(id,true); break;
                }
                case "zipBegin": case "zipChunk": case "zipAbort": io.execute(() -> zipOperation(id,method,p)); break;
                case "chooseZipFolder":
                    if (pendingFolder != null) throw new IOException("A folder picker is already open.");
                    pendingFolder = id;
                    try { startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE),PICK_ZIP_FOLDER); }
                    catch (android.content.ActivityNotFoundException e) {
                        pendingFolder = null;
                        throw new IOException("Could not open the system folder picker.");
                    }
                    break;
                case "zipSaveToFolder": {
                    Uri folder = zipFolder;
                    if (folder == null) throw new IOException("Choose a folder for the ZIPs first.");
                    io.execute(() -> saveZipToFolder(id,folder));
                    break;
                }
                case "zipSave":
                    if (pendingSave != null) throw new IOException("A save is already in progress");
                    pendingSave = id;
                    io.execute(() -> {
                        try {
                            finishZip();
                            main.post(() -> {
                                try { Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,zipName); startActivityForResult(intent,SAVE_DOCUMENT); }
                                catch (Exception e) { pendingSave=null; reject(id,"Could not open the system file picker"); }
                            });
                        } catch (Exception e) { main.post(() -> pendingSave=null); reject(id,e.getMessage()); }
                    }); break;
                case "share":
                    if (savedUri == null) throw new IOException("Save the ZIP first");
                    Intent share = new Intent(Intent.ACTION_SEND).setType("application/zip").putExtra(Intent.EXTRA_STREAM,savedUri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    share.setClipData(android.content.ClipData.newRawUri("RoleLeaf export",savedUri));
                    startActivity(Intent.createChooser(share,uiText(R.string.ui_share))); respond(id,true); break;
                default: reject(id,"Unsupported operation");
            }
        } catch (Exception e) { reject(id,e.getMessage()==null?"Operation failed":e.getMessage()); }
    }
    private void capture(String id,JSONObject message,WebView view) throws Exception {
        if (view == null || view.getUrl() == null) throw new IOException("Open a chat on the source site first");
        Uri current = Uri.parse(view.getUrl());
        if (!origin().equals(current.getScheme()+"://"+current.getHost())) throw new IOException("Open a chat on the source site first");
        if (!set("BOT_SIDEBAR","TIPSY_GET_CURRENT","TIPSY_CHAT","BOT_CAI","BOT_CREATOR","BOT_ANDROID_LIST").contains(message.optString("type"))) throw new IOException("Unsupported capture request");
        boolean creator = message.optString("type").equals("BOT_CREATOR");
        if (creator ? !set("profile","list","open_editor","read").contains(message.optString("action")) :
            message.has("action") && !set("status","start","cancel","export").contains(message.optString("action"))) throw new IOException("Invalid capture action");
        if (captures.size() >= 4) throw new IOException("Too many capture requests");
        String key = UUID.randomUUID().toString(); captures.put(key,new Capture(id,view));
        view.evaluateJavascript("window.__botAndroidRequest&&window.__botAndroidRequest("+JSONObject.quote(key)+","+message+")",null);
        main.postDelayed(() -> { Capture waiting = captures.remove(key); if (waiting != null) reject(waiting.request,"Source capture is unavailable. Refresh the page and try again."); },message.optString("action").equals("open_editor") ? 15000 : 8000);
    }
    private File imageFile(String id) throws IOException {
        if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid image ID");
        return new File(getCacheDir(),"image-"+id);
    }
    private void download(String request,JSONObject p) throws Exception {
        String key = p.getString("id"); File file = imageFile(key); URL url = mediaUrl(p.getString("url"));
        if (connections.size() >= 2 || connections.containsKey(key)) throw new IOException("Too many image requests");
        HttpURLConnection connection = (HttpURLConnection)url.openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(15000);
        connections.put(key,connection);
        downloads.execute(() -> {
            try {
                if (!connections.containsKey(key)) throw new IOException("Canceled");
                if (connection.getResponseCode()!=200) throw new IOException("Image HTTP "+connection.getResponseCode());
                long total=0;
                try (InputStream input=connection.getInputStream(); OutputStream out=new FileOutputStream(file)) {
                    byte[] buffer=new byte[32768]; int n;
                    while ((n=input.read(buffer))!=-1) { total+=n; if(total>16*1024*1024 || !connections.containsKey(key)) throw new IOException("Image exceeds the size limit or was canceled"); out.write(buffer,0,n); }
                }
                if (!connections.containsKey(key)) throw new IOException("Canceled");
                respond(request,obj("size",total));
            } catch(Exception e) { file.delete(); reject(request,"Image download failed: "+e.getMessage()); }
            finally { connection.disconnect(); connections.remove(key); }
        });
    }
    private void zipOperation(String id,String method,JSONObject p) {
        try {
            if (pendingSave != null) throw new IOException("Finish saving the current file first");
            if (method.equals("zipAbort") || method.equals("zipBegin")) {
                if (zipStream != null) { zipStream.close(); zipStream=null; }
                if (zip != null) zip.delete(); zip=null;
            }
            if (method.equals("zipBegin")) {
                zipName=p.getString("filename"); zipExpected=p.getLong("size");
                if (!zipName.matches("(?:tipsy|character_ai)_[^/\\\\\\p{Cntrl}]{1,220}\\.zip") || zipExpected<4 || zipExpected>ZIP_LIMIT) throw new IOException("Export file is invalid or exceeds 129 MB");
                zip=File.createTempFile("export-",".zip",getCacheDir()); zipStream=new FileOutputStream(zip); zipSize=0;
            } else if (method.equals("zipChunk")) {
                byte[] bytes=Base64.decode(p.getString("data"),Base64.NO_WRAP);
                if (zipStream==null || bytes.length>CHUNK || p.getLong("offset")!=zipSize || zipSize+bytes.length>zipExpected) throw new IOException("Invalid ZIP data order or size");
                zipStream.write(bytes); zipSize+=bytes.length;
            }
            respond(id,true);
        } catch (Exception e) { reject(id,e.getMessage()); }
    }
    private void finishZip() throws IOException {
        if (zipStream == null || zipSize != zipExpected) throw new IOException("ZIP is incomplete. Export again.");
        zipStream.close(); zipStream = null;
        try (InputStream input = new FileInputStream(zip)) {
            byte[] magic = new byte[4];
            if (input.read(magic) != 4 || !Arrays.equals(magic,new byte[]{80,75,3,4})) throw new IOException("Invalid ZIP format");
        }
    }
    private void saveZipToFolder(String id, Uri tree) {
        Uri file = null;
        try {
            finishZip();
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            file = DocumentsContract.createDocument(getContentResolver(),parent,"application/zip",zipName);
            if (file == null) throw new IOException("Could not create the ZIP file.");
            try (InputStream input = new FileInputStream(zip); OutputStream out = getContentResolver().openOutputStream(file,"w")) {
                if (out == null) throw new IOException("Could not write the ZIP file.");
                copy(input,out);
            }
            Uri savedFile = file;
            main.post(() -> savedUri = savedFile);
            respond(id,true);
        } catch (Exception e) {
            if (file != null) {
                try { DocumentsContract.deleteDocument(getContentResolver(),file); } catch (Exception ignored) {}
            }
            reject(id,"Could not save " + zipName + ". Check the selected folder and available space.");
        } finally {
            if (zip != null && zipStream == null) { zip.delete(); zip = null; }
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (request == PICK_ZIP_FOLDER) {
            String id = pendingFolder; pendingFolder = null;
            if (id == null) return;
            boolean selected = result == RESULT_OK && data != null && data.getData() != null;
            if (selected) zipFolder = data.getData();
            respond(id,selected);
            return;
        }
        if (request == OPEN_DOCUMENT) {
            if (result == RESULT_OK && data != null && data.getData() != null) viewZip(data.getData());
            return;
        }
        if (request!=SAVE_DOCUMENT || pendingSave==null) return;
        String id=pendingSave; pendingSave=null;
        if (result!=RESULT_OK || data==null || data.getData()==null) { respond(id,false); return; }
        Uri uri=data.getData(); File ready=zip;
        io.execute(() -> {
            try (InputStream input=new FileInputStream(ready); OutputStream out=getContentResolver().openOutputStream(uri,"wt")) {
                if(out==null) throw new IOException("Could not write the file"); copy(input,out); out.flush();
                main.post(() -> savedUri=uri); respond(id,true);
            } catch(Exception e) {
                try { android.provider.DocumentsContract.deleteDocument(getContentResolver(),uri); } catch(Exception ignored) {}
                reject(id,"Could not save the file. Choose a location and try again.");
            } finally { ready.delete(); }
        });
    }
    @Override public void onBackPressed() {
        if (busy) { toast(uiText(R.string.ui_wait_export)); return; }
        if (pickerOpen) {
            if (panelReady) panel.evaluateJavascript("window.closeBatchPicker&&window.closeBatchPicker()",null);
            else { try { dismissPicker(); } catch (IOException e) { toast(e.getMessage()); } }
            return;
        }
        if (popup!=null) { closePopup(); return; }
        if(source != null && source.canGoBack()) source.goBack(); else super.onBackPressed();
    }
    @Override protected void onPause() {
        super.onPause(); CookieManager.getInstance().flush();
        if(busy && panel!=null) panel.evaluateJavascript("window.dispatchEvent(new Event('capture-background'))",null);
    }
    @Override protected void onDestroy() {
        destroyed=true; main.removeCallbacksAndMessages(null);
        for(HttpURLConnection connection:connections.values()) downloads.execute(connection::disconnect);
        connections.clear();
        io.execute(() -> { try { if(zipStream!=null)zipStream.close(); } catch(Exception ignored) {} if(zip!=null)zip.delete(); });
        io.shutdown(); downloads.shutdown();
        closeWorker(); closePopup();
        if(panel!=null)panel.destroy();
        for (WebView view : siteViews.values()) view.destroy();
        super.onDestroy();
    }
}
