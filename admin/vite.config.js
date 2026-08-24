import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/pingping/',
  plugins: [vue()],
  server: {
    proxy: {
      '/admin-api': 'http://127.0.0.1:3001'
    }
  }
})
