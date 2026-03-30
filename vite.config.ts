import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/findspot/',
  plugins: [
    react(),
    VitePWA({
      // 'prompt' instead of 'autoUpdate' so a mid-session refresh doesn't
      // interrupt the user or risk a DB migration running without consent.
      registerType: 'prompt',
      includeAssets: ['logo.svg'],
      manifest: {
        name: 'FindSpot UK',
        short_name: 'FindSpot',
        description: 'Offline metal detecting find recording',
        theme_color: "#10b981",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/findspot/",
        icons: [
          {
            src: "logo.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          },
          {
            src: "logo.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Raise the limit to cover the main bundle (~2.4 MB uncompressed)
        // so the app works fully offline after installation.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: {
        // Enable the virtual PWA module in dev mode so useRegisterSW
        // works the same way in development as in production builds.
        enabled: true,
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large libraries into separate cacheable chunks
          'maplibre': ['maplibre-gl'],
          'turf': ['@turf/turf'],
          'pdf': ['jspdf', 'html2canvas'],
        }
      }
    }
  }
})
