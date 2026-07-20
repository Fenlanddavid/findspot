import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

const pasDensityRevision = createHash('sha256')
  .update(readFileSync(new URL('./public/pas-density-gb.json', import.meta.url)))
  .digest('hex')

export default defineConfig({
  base: '/findspot/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,geojson}'],
        // Explicitly precache the PAS density index (not covered by glob above
        // which excludes .json to avoid caching clubs.json / events.json).
        // Content-hash the fixed URL so Workbox replaces it when data changes.
        additionalManifestEntries: [
          { url: '/findspot/pas-density-gb.json', revision: pasDensityRevision },
        ],
        // Raise the limit to cover the main bundle (~2.4 MB uncompressed)
        // so the app works fully offline after installation.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // External API calls must bypass the service worker entirely.
        // These are read-only data fetches that must always go to the network.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/findspot-static\.trials-uk\.workers\.dev\//,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/findspot-bgs-proxy\.trials-uk\.workers\.dev\//,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/findspot-geocode\.trials-uk\.workers\.dev\//,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        // Enable the virtual PWA module in dev mode so useRegisterSW
        // works the same way in development as in production builds.
        enabled: true,
      }
    })
  ],
  build: {
    // Map rendering and PDF export are deliberately isolated into cacheable
    // vendor chunks. Keep the warning threshold aligned with those libraries
    // so real growth in the app chunk remains visible.
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split large libraries into separate cacheable chunks.
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre';
          if (id.includes('node_modules/@turf')) return 'turf';
          if (
            id.includes('node_modules/jspdf') ||
            id.includes('node_modules/html2canvas') ||
            id.includes('node_modules/dompurify')
          ) {
            return 'pdf';
          }
        }
      }
    }
  }
})
