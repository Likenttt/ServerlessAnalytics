import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API runs in `wrangler dev` (port 8787).
const api = process.env.API_URL ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': api, '/v1': api },
  },
  build: { sourcemap: true },
})
