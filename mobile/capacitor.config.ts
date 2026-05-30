import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.airone.ide',
  appName: 'Airone IDE',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#1e1e2e'
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1e1e2e'
    }
  }
};

export default config;
