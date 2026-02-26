import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    proxy: {
      // Proxy MAST JWST search API to avoid CORS (dev only; production uses /api/jwst)
      '/mast': {
        target: 'https://mast.stsci.edu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mast/, ''),
      },
    },
  },
})
