import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Tauri expects a fixed dev port and relative asset paths in production builds.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, outDir: 'dist' },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], globals: false },
})
