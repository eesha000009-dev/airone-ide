import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.airone.ide',
  appName: 'Airone IDE',
  webDir: 'lib/frontend',

  // Server configuration for connecting to the local Theia backend
  server: {
    // Use HTTP scheme (not HTTPS) to allow connecting to local Node.js backend
    androidScheme: 'http',
    // Allow cleartext HTTP connections to localhost backend
    cleartext: true,
    // Allow navigation to the local backend URL and any remote backends
    allowNavigation: ['localhost:3000', '127.0.0.1:3000', '*'],
    // No custom URL override - we handle this programmatically in MainActivity
  },

  android: {
    allowMixedContent: true,
    backgroundColor: '#1e1e2e',
    // Use the web contents to handle URL loading
    useLegacyBridge: false,
  },

  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1e1e2e'
    },
    SplashScreen: {
      // Splash screen configuration - matches the app's dark theme
      // The native splash shows while the backend starts up.
      // Once the backend is ready (or fails), the splash dismisses
      // and the WebView loads either the backend URL or the connect UI.
      launchShowDuration: 0,  // Duration handled by native code, not Capacitor
      launchAutoHide: false,  // We control splash dismissal in MainActivity
      backgroundColor: '#1e1e2e',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true
    }
  }
};

export default config;
