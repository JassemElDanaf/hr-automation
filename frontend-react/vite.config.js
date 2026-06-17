import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    open: true,
    // Candidate interview links are opened through a Cloudflare quick tunnel —
    // without this Vite rejects any non-localhost Host header with
    // "Blocked request. This host is not allowed."
    allowedHosts: true,
    // Same-origin API: the app calls relative /webhook and /recording so the
    // page works identically on localhost AND through a tunnel (a remote
    // candidate's browser can't reach the HR machine's localhost:5678/:8903).
    proxy: {
      '/webhook': 'http://localhost:5678',
      '/recording': 'http://localhost:8903',
      '/auth': 'http://localhost:8904',
    },
  },
})
