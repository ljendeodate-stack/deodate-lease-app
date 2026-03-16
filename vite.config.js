import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
  optimizeDeps: {
    // pdfjs-dist needs to be excluded from pre-bundling to avoid worker issues
    exclude: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
})
