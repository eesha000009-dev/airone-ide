package com.airone.ide;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The splash screen will be auto-hidden when the web content loads
        // since we set launchAutoHide to false in capacitor.config.ts,
        // we need to hide it programmatically when the app is ready
    }
}
