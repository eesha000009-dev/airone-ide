package com.airone.ide;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

/**
 * Main Activity for Airone IDE on Android.
 *
 * Startup flow:
 * 1. Native splash screen shows (dark background matching app theme)
 * 2. NodeJsBackendService is started to launch the Theia backend
 * 3. If backend becomes ready → WebView loads http://localhost:3000 (backend serves the full IDE)
 * 4. If backend fails or times out → WebView loads static frontend with "Connect to Backend" UI
 * 5. Native splash dismisses when WebView content is ready
 *
 * The Theia backend serves both the API and the frontend files, so when the backend
 * is running locally, the WebView loads directly from it for a seamless experience.
 * When no local backend is available, the static frontend files (from lib/frontend/)
 * provide a "Connect to Backend" UI where users can connect to a remote Theia instance.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";

    // The local Theia backend URL
    private static final String LOCAL_BACKEND_URL = "http://localhost:3000";

    // Timeout for waiting for the backend to be ready (15 seconds)
    private static final int BACKEND_READY_TIMEOUT_MS = 15000;

    // Delay after splash dismisses before checking WebView state
    private static final int WEBVIEW_SETTLE_DELAY_MS = 500;

    private Handler mainHandler;
    private BroadcastReceiver backendReceiver;
    private boolean backendReady = false;
    private boolean webViewLoaded = false;
    private boolean splashDismissed = false;
    private Runnable timeoutRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Install the splash screen BEFORE calling super.onCreate
        // This keeps the native splash visible while we wait for the backend
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // Keep the splash screen visible until we explicitly dismiss it
        splashScreen.setKeepOnScreenCondition(() -> !splashDismissed);

        super.onCreate(savedInstanceState);

        mainHandler = new Handler(Looper.getMainLooper());

        // Register broadcast receiver for backend status
        registerBackendReceiver();

        // Start the Node.js backend service
        startBackendService();

        // Set a timeout - if backend isn't ready in time, load WebView with connect UI
        timeoutRunnable = () -> {
            if (!backendReady && !splashDismissed) {
                Log.w(TAG, "Backend ready timeout reached, loading connect UI");
                dismissSplashAndLoadContent(false);
            }
        };
        mainHandler.postDelayed(timeoutRunnable, BACKEND_READY_TIMEOUT_MS);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (backendReceiver != null) {
            try {
                unregisterReceiver(backendReceiver);
            } catch (Exception e) {
                Log.w(TAG, "Error unregistering backend receiver", e);
            }
        }
        if (mainHandler != null && timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
        }
    }

    /**
     * Start the NodeJsBackendService.
     */
    private void startBackendService() {
        Log.i(TAG, "Starting NodeJsBackendService");
        Intent serviceIntent = new Intent(this, NodeJsBackendService.class);
        serviceIntent.setAction(NodeJsBackendService.ACTION_START_BACKEND);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    /**
     * Register a BroadcastReceiver to listen for backend status updates.
     */
    private void registerBackendReceiver() {
        backendReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;

                switch (action) {
                    case NodeJsBackendService.ACTION_BACKEND_READY:
                        int port = intent.getIntExtra(NodeJsBackendService.EXTRA_BACKEND_PORT, 3000);
                        Log.i(TAG, "Backend is ready on port " + port);
                        backendReady = true;
                        if (!splashDismissed) {
                            dismissSplashAndLoadContent(true);
                        }
                        break;

                    case NodeJsBackendService.ACTION_BACKEND_FAILED:
                        String error = intent.getStringExtra(NodeJsBackendService.EXTRA_ERROR_MESSAGE);
                        Log.w(TAG, "Backend failed: " + error);
                        if (!splashDismissed) {
                            dismissSplashAndLoadContent(false);
                        }
                        break;

                    case NodeJsBackendService.ACTION_BACKEND_STOPPED:
                        Log.i(TAG, "Backend stopped");
                        backendReady = false;
                        break;
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(NodeJsBackendService.ACTION_BACKEND_READY);
        filter.addAction(NodeJsBackendService.ACTION_BACKEND_FAILED);
        filter.addAction(NodeJsBackendService.ACTION_BACKEND_STOPPED);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(backendReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(backendReceiver, filter);
        }
    }

    /**
     * Dismiss the native splash screen and load the appropriate content in the WebView.
     *
     * @param backendAvailable true if the local Theia backend is running and ready
     */
    private void dismissSplashAndLoadContent(boolean backendAvailable) {
        if (splashDismissed) return;
        splashDismissed = true;

        // Remove the timeout callback
        if (mainHandler != null && timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
        }

        Log.i(TAG, "Dismissing splash, backend available: " + backendAvailable);

        if (backendAvailable) {
            // Backend is running - load the Theia IDE from the backend URL.
            // The backend serves both the API and the frontend, so loading
            // http://localhost:3000 gives us the full IDE with working WebSocket,
            // file operations, terminal, etc.
            loadBackendUrl();
        } else {
            // No backend available - the default Capacitor WebView content
            // (static files from lib/frontend/) will load, which contains
            // the "Connect to Backend" UI (from our modified preload.html)
            // The native splash will dismiss and the connect UI will be shown
        }

        // Signal that the splash can be dismissed
        // The setKeepOnScreenCondition will return false when splashDismissed is true
    }

    /**
     * Load the Theia backend URL in the WebView.
     * When the backend is running, it serves the complete IDE including the frontend.
     */
    private void loadBackendUrl() {
        try {
            // Give the WebView a moment to settle after Capacitor initialization
            mainHandler.postDelayed(() -> {
                try {
                    WebView webView = getBridge().getWebView();
                    if (webView != null) {
                        Log.i(TAG, "Loading backend URL: " + LOCAL_BACKEND_URL);
                        webView.loadUrl(LOCAL_BACKEND_URL);
                    } else {
                        Log.w(TAG, "WebView not available, relying on default content");
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error loading backend URL in WebView", e);
                }
            }, WEBVIEW_SETTLE_DELAY_MS);
        } catch (Exception e) {
            Log.e(TAG, "Error scheduling backend URL load", e);
        }
    }
}
