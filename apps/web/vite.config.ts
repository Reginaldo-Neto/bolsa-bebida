import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Spec 8.4: the app must open and show already-issued vouchers even with
      // no network, because venue wifi will not survive the whole party.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\/me\/orders/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'vouchers',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      manifest: {
        name: 'Bolsa de Bebidas',
        short_name: 'Bolsa',
        description: 'Mercado de bebidas ao vivo',
        lang: 'pt-PT',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  // The workspace packages are CommonJS, and Vite leaves linked packages out
  // of pre-bundling by default. Without this, the dev server cannot see some
  // of their named exports, while the production build (rollup) can — so the
  // app would only break in development.
  optimizeDeps: {
    include: ['@bolsa/shared'],
  },

  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: { sourcemap: true },
});
