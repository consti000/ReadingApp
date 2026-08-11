import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/** GitHub Pages 프로젝트 사이트는 https://<user>.github.io/<repo>/ 아래에서 서비스된다 */
const base = '/ReadingApp/'

/**
 * GitHub Pages 에는 SPA 폴백이 없어 /project/... 같은 주소로 직접 들어오면 404.html 이 응답된다.
 * 빌드된 index.html 을 그대로 복사해 두면 그 응답으로도 앱이 뜨고 라우터가 경로를 처리한다.
 */
function spaFallback(): Plugin {
  return {
    name: 'readlink:spa-fallback',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist/', import.meta.url))
      copyFileSync(`${dist}index.html`, `${dist}404.html`)
    },
  }
}

export default defineConfig({
  base,
  plugins: [
    react(),
    spaFallback(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ReadLink',
        short_name: 'ReadLink',
        description: '로컬 논문 리딩·연구 워크스페이스',
        theme_color: '#1a2332',
        background_color: '#0f1419',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        globIgnores: ['404.html'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'epubjs'],
  },
  worker: {
    format: 'es',
  },
})
