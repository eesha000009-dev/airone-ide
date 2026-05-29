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

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";

    // Timeout for waiting for the backend to be ready (30 seconds)
    private static final int BACKEND_READY_TIMEOUT_MS = 30000;

    private Handler mainHandler;
    private BroadcastReceiver backendReceiver;
    private boolean backendReady = false;
    private boolean webViewLoaded = false;
    private Runnable timeoutRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Install the splash screen BEFORE calling super.onCreate
        // This keeps the native splash visible while we wait for the backend
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // Keep the splash screen visible until we dismiss it
        splashScreen.setKeepOnScreenCondition(() -> !webViewLoaded);

        super.onCreate(savedInstanceState);

        mainHandler = new Handler(Looper.getMainLooper());

        // Register broadcast receiver for backend status
        registerBackendReceiver();

        // Start the Node.js backend service
        startBackendService();

        // Set a timeout - if backend isn't ready in 30 seconds, load WebView anyway
        timeoutRunnable = () -> {
            if (!backendReady && !webViewLoaded) {
                Log.w(TAG, "Backend ready timeout reached, loading WebView without local backend");
                loadWebViewContent();
            }
        };
        mainHandler.postDelayed(timeoutRunnable, BACKEND_READY_TIMEOUT_MS);
    }

    @Override
    protected void onDestroy() {
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
                        Log.i(TAG, "Backend is ready!");
                        backendReady = true;
                        if (!webViewLoaded) {
                            loadWebViewContent();
                        }
                        break;

                    case NodeJsBackendService.ACTION_BACKEND_FAILED:
                        String error = intent.getStringExtra(NodeJsBackendService.EXTRA_ERROR_MESSAGE);
                        Log.w(TAG, "Backend failed: " + error);
                        if (!webViewLoaded) {
                            // Load WebView anyway - the preload page has a fallback
                            loadWebViewContent();
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
     * Load the WebView content.
     * This is called either when the backend is ready or after a timeout.
     */
    private void loadWebViewContent() {
        if (webViewLoaded) return;
        webViewLoaded = true;

        Log.i(TAG, "Loading WebView content (backend ready: " + backendReady + ")");

        // Remove the timeout callback
        if (mainHandler != null && timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
        }

        // The splash screen will be automatically dismissed by the
        // setKeepOnScreenCondition when webViewLoaded becomes true.
        // Capacitor's BridgeActivity will load the WebView content
        // in its own lifecycle, so we just need to signal that it's okay
        // to dismiss the splash.
    }
}
