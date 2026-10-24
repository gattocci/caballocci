import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.caballocci.mobilesync',
  appName: 'Caballocci Mobile Sync',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
