import { defineConfig } from 'vite'
import { geaPlugin } from '@geajs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [geaPlugin(), tailwindcss()],
  resolve: {
    alias: {
      '@geajs/core': path.resolve(__dirname, '../node_modules/@geajs/core')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000'
    }
  },
  build: {
    modulePreload: { polyfill: false },
  },
})
