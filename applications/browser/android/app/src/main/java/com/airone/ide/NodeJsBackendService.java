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
 * This service:
 * - Extracts the Node.js binary from APK assets to internal storage
 * - Makes the binary executable
 * - Starts the Node.js process running the Theia backend
 * - Monitors the process and restarts it if it crashes
 * - Broadcasts when the backend is ready (listening on port 3000)
 * - Runs as a foreground service with a notification
 *
 * IMPORTANT: The Node.js binary for Android ARM64 needs to be compiled
 * using the Android NDK and placed at assets/nodejs/bin/node.
 * Until the binary is bundled, the app operates in "remote backend" mode
 * where users can connect to a Theia backend running on their network.
 *
 * To compile Node.js for Android ARM64:
 * 1. Install Android NDK (r25+)
 * 2. Clone Node.js source: git clone https://github.com/nodejs/node
 * 3. Configure for Android: ./configure --dest-cpu=arm64 --dest-os=android
 * 4. Build: make -j$(nproc)
 * 5. Copy the resulting 'node' binary to assets/nodejs/bin/node
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
    private static final String NODE_BINARY_ASSET_PATH = "nodejs/bin/node";
    private static final String BACKEND_DIR_ASSET_PATH = "backend";
    private static final String NODE_BINARY_DIR = "nodejs";
    private static final String NODE_BINARY_NAME = "node";
    private static final String BACKEND_DIR_NAME = "backend";
    private static final String PREFS_NAME = "airone_backend_prefs";
    private static final String PREF_KEY_PORT = "backend_port";

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
                boolean nodeBinaryInAssets = checkAssetExists(NODE_BINARY_ASSET_PATH);
                if (!nodeBinaryInAssets) {
                    Log.w(TAG, "Node.js binary not found in assets. " +
                        "The binary needs to be compiled for Android ARM64 using the NDK " +
                        "and placed at assets/" + NODE_BINARY_ASSET_PATH);
                    broadcastFailed("Node.js binary not available. " +
                        "The app is running in remote backend mode. " +
                        "Connect to a Theia backend on your network.");
                    return;
                }

                // Step 2: Extract Node.js binary from assets
                File nodeBinary = extractNodeBinary();
                if (nodeBinary == null) {
                    broadcastFailed("Failed to extract Node.js binary from assets.");
                    return;
                }

                // Step 3: Check if backend files exist in assets
                boolean backendInAssets = checkAssetDirExists(BACKEND_DIR_ASSET_PATH);
                if (!backendInAssets) {
                    Log.w(TAG, "Backend files not found in assets/" + BACKEND_DIR_ASSET_PATH);
                    broadcastFailed("Backend files not available in assets.");
                    return;
                }

                // Step 4: Extract backend files from assets
                File backendDir = extractBackendFiles();
                if (backendDir == null) {
                    broadcastFailed("Failed to extract backend files from assets.");
                    return;
                }

                // Step 5: Start the Node.js process
                startNodeProcess(nodeBinary, backendDir);

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

        // Save port as 0 to indicate stopped
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

    /**
     * Check if an asset file exists.
     * @param assetPath The path within the assets directory.
     * @return true if the asset exists.
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
     * @param assetDirPath The directory path within the assets directory.
     * @return true if the directory exists and has files.
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
     * Extract the Node.js binary from APK assets to internal storage.
     * @return File pointing to the extracted binary, or null if not found.
     */
    private File extractNodeBinary() {
        try {
            File targetDir = new File(getFilesDir(), NODE_BINARY_DIR);
            File targetFile = new File(targetDir, NODE_BINARY_NAME);

            // Check if already extracted and valid (same size as asset)
            if (targetFile.exists() && targetFile.canExecute() && targetFile.length() > 0) {
                // Verify the binary still matches the one in assets (in case of app update)
                try {
                    InputStream assetIs = getAssets().open(NODE_BINARY_ASSET_PATH);
                    long assetSize = getAssetSize(assetIs);
                    assetIs.close();

                    if (targetFile.length() == assetSize) {
                        Log.i(TAG, "Node binary already extracted and valid: " + targetFile.getAbsolutePath());
                        return targetFile;
                    } else {
                        Log.i(TAG, "Node binary changed, re-extracting...");
                        targetFile.delete();
                    }
                } catch (IOException e) {
                    // Can't check size, assume it's still valid
                    Log.i(TAG, "Node binary exists, using cached version: " + targetFile.getAbsolutePath());
                    return targetFile;
                }
            }

            // Copy from assets
            try (InputStream is = getAssets().open(NODE_BINARY_ASSET_PATH)) {
                targetDir.mkdirs();
                copyStream(is, targetFile);

                // Make executable
                if (!targetFile.setExecutable(true, false)) {
                    Log.w(TAG, "Failed to set executable permission via File API, trying chmod");
                    Runtime.getRuntime().exec(new String[]{"chmod", "755", targetFile.getAbsolutePath()}).waitFor();
                }

                // Verify it's executable
                if (!targetFile.canExecute()) {
                    Log.e(TAG, "Node binary is not executable after chmod!");
                    return null;
                }

                Log.i(TAG, "Node binary extracted to: " + targetFile.getAbsolutePath() +
                    " (size: " + targetFile.length() + ", executable: " + targetFile.canExecute() + ")");
                return targetFile;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error extracting Node.js binary", e);
            return null;
        }
    }

    /**
     * Get the size of an asset stream without reading all data.
     */
    private long getAssetSize(InputStream is) throws IOException {
        byte[] buffer = new byte[8192];
        long total = 0;
        int bytesRead;
        while ((bytesRead = is.read(buffer)) != -1) {
            total += bytesRead;
        }
        return total;
    }

    /**
     * Extract backend files from APK assets to internal storage.
     * @return File pointing to the backend directory, or null if not found.
     */
    private File extractBackendFiles() {
        try {
            File targetDir = new File(getFilesDir(), BACKEND_DIR_NAME);

            // Check if already extracted (look for main.js)
            File mainJs = new File(targetDir, "main.js");
            if (mainJs.exists() && mainJs.length() > 0) {
                Log.i(TAG, "Backend files already extracted to: " + targetDir.getAbsolutePath());
                return targetDir;
            }

            // Copy from assets
            String[] assetFiles = getAssets().list(BACKEND_DIR_ASSET_PATH);
            if (assetFiles == null || assetFiles.length == 0) {
                Log.w(TAG, "No backend files found in assets/" + BACKEND_DIR_ASSET_PATH);
                return null;
            }

            // Recursively copy backend directory
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

            // Check if it's a directory
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

    /**
     * Start the Node.js process with the Theia backend.
     */
    private void startNodeProcess(File nodeBinary, File backendDir) {
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
            pb.environment().put("NODE_ENV", "production");
            pb.environment().put("THEIA_HOST", BACKEND_HOST);
            pb.environment().put("THEIA_PORT", String.valueOf(BACKEND_PORT));

            // Set HOME for npm/node modules resolution
            pb.environment().put("HOME", getFilesDir().getAbsolutePath());
            pb.environment().put("NODE_PATH", new File(backendDir, "node_modules").getAbsolutePath());

            // Android-specific environment
            pb.environment().put("ANDROID_ROOT", System.getenv("ANDROID_ROOT"));
            pb.environment().put("ANDROID_DATA", System.getenv("ANDROID_DATA"));

            Log.i(TAG, "Starting Node.js backend: " + nodePath + " " + mainPath +
                " --port " + BACKEND_PORT + " --hostname " + BACKEND_HOST);

            nodeProcess = pb.start();
            isRunning = true;
            restartAttempts = 0;

            // Monitor process output in a separate thread
            monitorProcessOutput();

            // Start health check to detect when backend is ready
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
                // Process crashed unexpectedly - try to restart
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

    /**
     * Start periodic health checks to detect when the backend is ready.
     */
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

        // First check after a short delay
        mainHandler.postDelayed(healthCheckRunnable, 2000);
    }

    /**
     * Stop the health check.
     */
    private void stopHealthCheck() {
        if (healthCheckRunnable != null) {
            mainHandler.removeCallbacks(healthCheckRunnable);
            healthCheckRunnable = null;
        }
    }

    /**
     * Check if the backend is responding on the configured port.
     * @return true if backend is responding.
     */
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

    /**
     * Broadcast that the backend is ready.
     */
    private void broadcastReady() {
        Log.i(TAG, "Backend is ready on port " + BACKEND_PORT);
        Intent intent = new Intent(ACTION_BACKEND_READY);
        intent.putExtra(EXTRA_BACKEND_PORT, BACKEND_PORT);
        sendBroadcast(intent);
    }

    /**
     * Broadcast that the backend has failed.
     */
    private void broadcastFailed(String errorMessage) {
        Log.e(TAG, "Backend failed: " + errorMessage);
        isRunning = false;
        updateNotification("Backend not available");

        Intent intent = new Intent(ACTION_BACKEND_FAILED);
        intent.putExtra(EXTRA_ERROR_MESSAGE, errorMessage);
        sendBroadcast(intent);
    }

    /**
     * Save the backend port to SharedPreferences.
     */
    private void saveBackendPort(int port) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(PREF_KEY_PORT, port).apply();
    }

    /**
     * Get the saved backend port from SharedPreferences.
     * @return The port number, or 0 if not saved.
     */
    public static int getSavedBackendPort(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(PREF_KEY_PORT, 0);
    }

    /**
     * Create the notification channel for the foreground service.
     */
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

    /**
     * Create a notification for the foreground service.
     */
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

    /**
     * Update the foreground service notification.
     */
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

    /**
     * Copy an InputStream to a File.
     */
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
