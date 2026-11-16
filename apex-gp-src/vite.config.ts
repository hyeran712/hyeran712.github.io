import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works from any sub-path (e.g. GitHub Pages /apex-gp/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../apex-gp',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
})
