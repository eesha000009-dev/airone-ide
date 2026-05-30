package com.airone.ide;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android Service that runs the Theia IDE Node.js backend.
 *
 * This service supports two types of Node.js binaries:
 *
 * 1. **Standalone binary** - Compiled from source with NDK, statically linked.
 *    Placed at: assets/nodejs/bin/node
 *    No shared library dependencies needed.
 *
 * 2. **Termux binary** - Downloaded from Termux package repository, dynamically linked.
 *    Placed at: assets/nodejs/bin/node
 *    Shared libraries at: assets/nodejs/lib/*.so
 *    Requires LD_LIBRARY_PATH to find shared libraries.
 *
 * The service:
 * - Extracts the Node.js binary and shared libraries from APK assets
 * - Makes the binary executable
 * - Starts the Node.js process running the Theia backend
 * - Monitors the process and restarts it if it crashes
 * - Broadcasts when the backend is ready (listening on port 3000)
 * - Runs as a foreground service with a notification
 */
public class NodeJsBackendService extends Service {

    private static final String TAG = "NodeJsBackendService";

    // Intent actions
    public static final String ACTION_START_BACKEND = "com.airone.ide.action.START_BACKEND";
    public static final String ACTION_STOP_BACKEND = "com.airone.ide.action.STOP_BACKEND";

    // Broadcast actions
    public static final String ACTION_BACKEND_READY = "com.airone.ide.action.BACKEND_READY";
    public static final String ACTION_BACKEND_FAILED = "com.airone.ide.action.BACKEND_FAILED";
    public static final String ACTION_BACKEND_STOPPED = "com.airone.ide.action.BACKEND_STOPPED";

    // Extra keys
    public static final String EXTRA_BACKEND_PORT = "backend_port";
    public static final String EXTRA_ERROR_MESSAGE = "error_message";

    // Configuration
    private static final int BACKEND_PORT = 3000;
    private static final String BACKEND_HOST = "0.0.0.0";

    // Asset paths
    private static final String NODE_BINARY_ASSET_PATH = "nodejs/bin/node";
    private static final String NODE_LIB_ASSET_PATH = "nodejs/lib";
    private static final String BACKEND_DIR_ASSET_PATH = "backend";

    // Internal storage directory names
    private static final String NODE_BINARY_DIR = "nodejs";
    private static final String NODE_BINARY_NAME = "node";
    private static final String NODE_LIB_DIR_NAME = "nodejs-lib";
    private static final String BACKEND_DIR_NAME = "backend";

    // SharedPreferences
    private static final String PREFS_NAME = "airone_backend_prefs";
    private static final String PREF_KEY_PORT = "backend_port";
    private static final String PREF_KEY_EXTRACT_VERSION = "extract_version";

    // Current extraction version - increment if asset structure changes
    private static final int CURRENT_EXTRACT_VERSION = 2;

    // Notification
    private static final int NOTIFICATION_ID = 1001;
    private static final String NOTIFICATION_CHANNEL_ID = "airone_backend_channel";

    // Health check
    private static final int HEALTH_CHECK_INTERVAL_MS = 1000;
    private static final int HEALTH_CHECK_TIMEOUT_MS = 30000;
    private static final int MAX_RESTART_ATTEMPTS = 3;
    private static final int RESTART_DELAY_MS = 2000;

    private Process nodeProcess;
    private volatile boolean isRunning = false;
    private volatile boolean isBackendReady = false;
    private int restartAttempts = 0;
    private ExecutorService executorService;
    private Handler mainHandler;
    private Runnable healthCheckRunnable;
    private int healthCheckElapsed = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        executorService = Executors.newFixedThreadPool(3);
        mainHandler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP_BACKEND.equals(action)) {
                stopBackend();
                return START_NOT_STICKY;
            }
        }

        // Start as foreground service
        startForeground(NOTIFICATION_ID, createNotification("Starting backend..."));

        if (!isRunning) {
            startBackend();
        }

        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopBackend();
        if (executorService != null) {
            executorService.shutdownNow();
        }
    }

    /**
     * Start the Node.js backend.
     * Extracts assets, makes binary executable, and starts the process.
     * If the Node.js binary is not available, broadcasts failure immediately.
     */
    public void startBackend() {
        if (isRunning) {
            Log.i(TAG, "Backend is already running");
            return;
        }

        executorService.execute(() -> {
            try {
                // Step 1: Check if Node.js binary exists in assets
                if (!checkAssetExists(NODE_BINARY_ASSET_PATH)) {
                    Log.w(TAG, "Node.js binary not found in assets/" + NODE_BINARY_ASSET_PATH);
                    broadcastFailed("Node.js binary not available. " +
                        "Run scripts/download-termux-nodejs.sh to download it.");
                    return;
                }

                // Step 2: Check if backend files exist
                if (!checkAssetDirExists(BACKEND_DIR_ASSET_PATH)) {
                    Log.w(TAG, "Backend files not found in assets/" + BACKEND_DIR_ASSET_PATH);
                    broadcastFailed("Backend files not available in assets.");
                    return;
                }

                // Step 3: Extract Node.js binary
                File nodeBinary = extractNodeBinary();
                if (nodeBinary == null) {
                    broadcastFailed("Failed to extract Node.js binary from assets.");
                    return;
                }

                // Step 4: Extract shared libraries (for Termux binary)
                File libDir = extractSharedLibraries();

                // Step 5: Extract backend files
                File backendDir = extractBackendFiles();
                if (backendDir == null) {
                    broadcastFailed("Failed to extract backend files from assets.");
                    return;
                }

                // Step 6: Create temp directory
                File tmpDir = new File(getCacheDir(), "nodejs-tmp");
                tmpDir.mkdirs();

                // Step 7: Start the Node.js process
                startNodeProcess(nodeBinary, backendDir, libDir, tmpDir);

            } catch (Exception e) {
                Log.e(TAG, "Failed to start backend", e);
                broadcastFailed("Failed to start backend: " + e.getMessage());
            }
        });
    }

    /**
     * Stop the Node.js backend.
     */
    public void stopBackend() {
        Log.i(TAG, "Stopping backend");
        isRunning = false;
        isBackendReady = false;
        stopHealthCheck();

        if (nodeProcess != null) {
            try {
                nodeProcess.destroy();
                nodeProcess.waitFor();
            } catch (Exception e) {
                Log.w(TAG, "Error stopping Node.js process", e);
            }
            nodeProcess = null;
        }

        saveBackendPort(0);

        Intent stoppedIntent = new Intent(ACTION_BACKEND_STOPPED);
        sendBroadcast(stoppedIntent);

        updateNotification("Backend stopped");

        stopForeground(true);
        stopSelf();
    }

    /**
     * Check if the backend is currently running.
     */
    public boolean isBackendRunning() {
        return isRunning && nodeProcess != null && nodeProcess.isAlive();
    }

    // =========================================================================
    // Asset extraction
    // =========================================================================

    /**
     * Check if an asset file exists.
     */
    private boolean checkAssetExists(String assetPath) {
        try {
            InputStream is = getAssets().open(assetPath);
            is.close();
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Check if an asset directory exists and has contents.
     */
    private boolean checkAssetDirExists(String assetDirPath) {
        try {
            String[] files = getAssets().list(assetDirPath);
            return files != null && files.length > 0;
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Check if we need to re-extract assets (e.g., after app update).
     */
    private boolean needsReExtraction() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int extractedVersion = prefs.getInt(PREF_KEY_EXTRACT_VERSION, 0);
        return extractedVersion < CURRENT_EXTRACT_VERSION;
    }

    /**
     * Mark extraction as complete.
     */
    private void markExtractionComplete() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(PREF_KEY_EXTRACT_VERSION, CURRENT_EXTRACT_VERSION).apply();
    }

    /**
     * Extract the Node.js binary from APK assets to internal storage.
     * Works with both standalone (NDK-compiled) and Termux binaries.
     */
    private File extractNodeBinary() {
        try {
            File targetDir = new File(getFilesDir(), NODE_BINARY_DIR);
            File targetFile = new File(targetDir, NODE_BINARY_NAME);

            // Check if already extracted and valid
            if (targetFile.exists() && targetFile.canExecute() && targetFile.length() > 0 && !needsReExtraction()) {
                Log.i(TAG, "Node binary already extracted: " + targetFile.getAbsolutePath());
                return targetFile;
            }

            // Copy from assets
            try (InputStream is = getAssets().open(NODE_BINARY_ASSET_PATH)) {
                targetDir.mkdirs();
                copyStream(is, targetFile);

                // Make executable
                if (!targetFile.setExecutable(true, false)) {
                    Runtime.getRuntime().exec(new String[]{"chmod", "755", targetFile.getAbsolutePath()}).waitFor();
                }

                if (!targetFile.canExecute()) {
                    Log.e(TAG, "Node binary is not executable after chmod!");
                    return null;
                }

                Log.i(TAG, "Node binary extracted: " + targetFile.getAbsolutePath() +
                    " (size: " + targetFile.length() + ")");
                return targetFile;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error extracting Node.js binary", e);
            return null;
        }
    }

    /**
     * Extract shared libraries from APK assets to internal storage.
     * Required for Termux Node.js binary which depends on dynamic libraries.
     * Returns null if no shared libraries are found (standalone binary).
     */
    private File extractSharedLibraries() {
        try {
            File targetDir = new File(getFilesDir(), NODE_LIB_DIR_NAME);

            // Check if already extracted
            if (targetDir.exists() && !needsReExtraction()) {
                File[] libs = targetDir.listFiles((dir, name) -> name.endsWith(".so"));
                if (libs != null && libs.length > 0) {
                    Log.i(TAG, "Shared libraries already extracted: " + targetDir.getAbsolutePath() +
                        " (" + libs.length + " files)");
                    return targetDir;
                }
            }

            // Check if shared libraries exist in assets
            String[] assetLibs = getAssets().list(NODE_LIB_ASSET_PATH);
            if (assetLibs == null || assetLibs.length == 0) {
                Log.i(TAG, "No shared libraries in assets (standalone Node.js binary)");
                return null;
            }

            // Extract all shared libraries
            targetDir.mkdirs();
            int extractedCount = 0;

            for (String libName : assetLibs) {
                String assetPath = NODE_LIB_ASSET_PATH + "/" + libName;
                File targetFile = new File(targetDir, libName);

                try (InputStream is = getAssets().open(assetPath)) {
                    copyStream(is, targetFile);
                    extractedCount++;
                    Log.d(TAG, "Extracted: " + libName);
                } catch (IOException e) {
                    Log.w(TAG, "Failed to extract: " + libName, e);
                }
            }

            if (extractedCount > 0) {
                Log.i(TAG, "Extracted " + extractedCount + " shared libraries to: " + targetDir.getAbsolutePath());
                return targetDir;
            } else {
                Log.w(TAG, "No shared libraries were extracted");
                return null;
            }
        } catch (IOException e) {
            Log.w(TAG, "No shared libraries found in assets (standalone binary)", e);
            return null;
        }
    }

    /**
     * Extract backend files from APK assets to internal storage.
     */
    private File extractBackendFiles() {
        try {
            File targetDir = new File(getFilesDir(), BACKEND_DIR_NAME);

            // Check if already extracted
            File mainJs = new File(targetDir, "main.js");
            if (mainJs.exists() && mainJs.length() > 0 && !needsReExtraction()) {
                Log.i(TAG, "Backend files already extracted: " + targetDir.getAbsolutePath());
                return targetDir;
            }

            // Copy from assets
            String[] assetFiles = getAssets().list(BACKEND_DIR_ASSET_PATH);
            if (assetFiles == null || assetFiles.length == 0) {
                Log.w(TAG, "No backend files in assets/" + BACKEND_DIR_ASSET_PATH);
                return null;
            }

            copyAssetDir(BACKEND_DIR_ASSET_PATH, targetDir);
            Log.i(TAG, "Backend files extracted to: " + targetDir.getAbsolutePath());
            return targetDir;
        } catch (Exception e) {
            Log.e(TAG, "Error extracting backend files", e);
            return null;
        }
    }

    /**
     * Recursively copy a directory from assets to internal storage.
     */
    private void copyAssetDir(String assetPath, File targetDir) throws IOException {
        targetDir.mkdirs();
        String[] files = getAssets().list(assetPath);
        if (files == null) return;

        for (String file : files) {
            String assetFilePath = assetPath + "/" + file;
            File targetFile = new File(targetDir, file);

            String[] subFiles = getAssets().list(assetFilePath);
            if (subFiles != null && subFiles.length > 0) {
                copyAssetDir(assetFilePath, targetFile);
            } else {
                try (InputStream is = getAssets().open(assetFilePath)) {
                    copyStream(is, targetFile);
                }
            }
        }
    }

    // =========================================================================
    // Node.js process management
    // =========================================================================

    /**
     * Start the Node.js process with the Theia backend.
     *
     * @param nodeBinary The extracted Node.js binary
     * @param backendDir The extracted backend directory
     * @param libDir The shared libraries directory (null for standalone binary)
     * @param tmpDir The temp directory for Node.js
     */
    private void startNodeProcess(File nodeBinary, File backendDir, File libDir, File tmpDir) {
        try {
            File mainJs = new File(backendDir, "main.js");
            if (!mainJs.exists()) {
                broadcastFailed("main.js not found in backend directory");
                return;
            }

            String nodePath = nodeBinary.getAbsolutePath();
            String mainPath = mainJs.getAbsolutePath();

            ProcessBuilder pb = new ProcessBuilder(
                nodePath,
                mainPath,
                "--port", String.valueOf(BACKEND_PORT),
                "--hostname", BACKEND_HOST
            );

            pb.directory(backendDir);
            pb.redirectErrorStream(true);

            // === Environment variables ===

            // Production mode
            pb.environment().put("NODE_ENV", "production");

            // Theia configuration
            pb.environment().put("THEIA_HOST", BACKEND_HOST);
            pb.environment().put("THEIA_PORT", String.valueOf(BACKEND_PORT));

            // Home directory (overrides Termux hardcoded path)
            pb.environment().put("HOME", getFilesDir().getAbsolutePath());

            // Temp directory (overrides Termux hardcoded path)
            pb.environment().put("TMPDIR", tmpDir.getAbsolutePath());
            pb.environment().put("TEMP", tmpDir.getAbsolutePath());
            pb.environment().put("TMP", tmpDir.getAbsolutePath());

            // Node.js module resolution
            pb.environment().put("NODE_PATH", new File(backendDir, "node_modules").getAbsolutePath());

            // === CRITICAL: LD_LIBRARY_PATH for Termux binary ===
            // The Termux Node.js binary is dynamically linked against shared
            // libraries (.so files) that we bundle in the APK. Without this,
            // the binary won't find its dependencies and will fail to start.
            if (libDir != null && libDir.exists()) {
                String ldPath = libDir.getAbsolutePath();
                // Preserve existing LD_LIBRARY_PATH if set
                String existingLdPath = pb.environment().get("LD_LIBRARY_PATH");
                if (existingLdPath != null && !existingLdPath.isEmpty()) {
                    ldPath = ldPath + ":" + existingLdPath;
                }
                pb.environment().put("LD_LIBRARY_PATH", ldPath);
                Log.i(TAG, "LD_LIBRARY_PATH set to: " + ldPath);
            }

            // Android-specific environment
            pb.environment().put("ANDROID_ROOT", System.getenv("ANDROID_ROOT"));
            pb.environment().put("ANDROID_DATA", System.getenv("ANDROID_DATA"));

            // Disable Node.js warnings that clutter the log
            pb.environment().put("NODE_NO_WARNINGS", "1");

            Log.i(TAG, "Starting Node.js backend: " + nodePath + " " + mainPath +
                " --port " + BACKEND_PORT + " --hostname " + BACKEND_HOST);

            nodeProcess = pb.start();
            isRunning = true;
            restartAttempts = 0;

            // Mark extraction as complete after successful start
            markExtractionComplete();

            // Monitor process output
            monitorProcessOutput();

            // Start health check
            startHealthCheck();

            updateNotification("Backend starting...");

        } catch (IOException e) {
            Log.e(TAG, "Failed to start Node.js process", e);
            broadcastFailed("Failed to start Node.js: " + e.getMessage());
        }
    }

    /**
     * Monitor the Node.js process output and detect crashes.
     */
    private void monitorProcessOutput() {
        executorService.execute(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(nodeProcess.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    Log.d(TAG, "[node] " + line);
                }
            } catch (IOException e) {
                Log.w(TAG, "Error reading Node.js output", e);
            }

            // Process has exited
            try {
                int exitCode = nodeProcess.waitFor();
                Log.w(TAG, "Node.js process exited with code: " + exitCode);
            } catch (InterruptedException e) {
                Log.w(TAG, "Interrupted while waiting for Node.js process exit", e);
            }

            if (isRunning) {
                isRunning = false;
                isBackendReady = false;
                stopHealthCheck();

                if (restartAttempts < MAX_RESTART_ATTEMPTS) {
                    restartAttempts++;
                    Log.i(TAG, "Attempting restart (" + restartAttempts + "/" + MAX_RESTART_ATTEMPTS + ")");
                    mainHandler.postDelayed(() -> startBackend(), RESTART_DELAY_MS);
                } else {
                    broadcastFailed("Backend crashed and max restart attempts reached");
                }
            }
        });
    }

    // =========================================================================
    // Health check
    // =========================================================================

    private void startHealthCheck() {
        healthCheckElapsed = 0;

        healthCheckRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isRunning || isBackendReady) return;

                healthCheckElapsed += HEALTH_CHECK_INTERVAL_MS;

                if (healthCheckElapsed >= HEALTH_CHECK_TIMEOUT_MS) {
                    Log.w(TAG, "Backend health check timed out after " + HEALTH_CHECK_TIMEOUT_MS + "ms");
                    broadcastFailed("Backend startup timed out");
                    return;
                }

                executorService.execute(() -> {
                    if (checkBackendHealth()) {
                        isBackendReady = true;
                        saveBackendPort(BACKEND_PORT);
                        broadcastReady();
                        updateNotification("Backend running on port " + BACKEND_PORT);
                    } else {
                        mainHandler.postDelayed(this, HEALTH_CHECK_INTERVAL_MS);
                    }
                });
            }
        };

        mainHandler.postDelayed(healthCheckRunnable, 2000);
    }

    private void stopHealthCheck() {
        if (healthCheckRunnable != null) {
            mainHandler.removeCallbacks(healthCheckRunnable);
            healthCheckRunnable = null;
        }
    }

    private boolean checkBackendHealth() {
        try {
            URL url = new URL("http://localhost:" + BACKEND_PORT);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("HEAD");
            conn.setConnectTimeout(1000);
            conn.setReadTimeout(1000);
            int responseCode = conn.getResponseCode();
            conn.disconnect();
            return responseCode > 0;
        } catch (Exception e) {
            return false;
        }
    }

    // =========================================================================
    // Broadcasts
    // =========================================================================

    private void broadcastReady() {
        Log.i(TAG, "Backend is ready on port " + BACKEND_PORT);
        Intent intent = new Intent(ACTION_BACKEND_READY);
        intent.putExtra(EXTRA_BACKEND_PORT, BACKEND_PORT);
        sendBroadcast(intent);
    }

    private void broadcastFailed(String errorMessage) {
        Log.e(TAG, "Backend failed: " + errorMessage);
        isRunning = false;
        updateNotification("Backend not available");

        Intent intent = new Intent(ACTION_BACKEND_FAILED);
        intent.putExtra(EXTRA_ERROR_MESSAGE, errorMessage);
        sendBroadcast(intent);
    }

    // =========================================================================
    // SharedPreferences
    // =========================================================================

    private void saveBackendPort(int port) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(PREF_KEY_PORT, port).apply();
    }

    public static int getSavedBackendPort(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(PREF_KEY_PORT, 0);
    }

    // =========================================================================
    // Notification
    // =========================================================================

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Airone IDE Backend",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Running the Airone IDE backend server");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification createNotification(String message) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Airone IDE")
            .setContentText(message)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build();
    }

    private void updateNotification(String message) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, createNotification(message));
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to update notification", e);
        }
    }

    // =========================================================================
    // Utility
    // =========================================================================

    private static void copyStream(InputStream is, File target) throws IOException {
        try (OutputStream os = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = is.read(buffer)) != -1) {
                os.write(buffer, 0, bytesRead);
            }
            os.flush();
        }
    }
}
