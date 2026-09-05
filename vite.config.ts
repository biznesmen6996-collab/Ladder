import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Ścieżka bazowa: '/nazwa-repo/' przy publikacji na GitHub Pages,
// './' przy uruchamianiu lokalnie i z pliku.
const base = process.env.VITE_BASE ?? './'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Ladder Studio — PLC IDE',
        short_name: 'Ladder Studio',
        description: 'Edytor drabinkowy PLC z symulacją czasu rzeczywistego i HMI',
        theme_color: '#0f1420',
        background_color: '#0f1420',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
