import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',   // ← importante para que Electron encuentre los assets
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
})
