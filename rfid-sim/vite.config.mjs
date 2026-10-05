export default {
  root: new URL('.', import.meta.url).pathname,
  server: {
    port: 5399,
    strictPort: true,
    proxy: {
      // The shop's edge, for counting a delivery in (Receive at store).
      '/store': {
        target: process.env.VITE_STORE_TARGET ?? 'http://127.0.0.1:8182',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/store/, ''),
      },
      // The centre: which tags each surat jalan carried (the handheld's
      // stand-in for the cartons physically in front of it).
      '/cloud': {
        target: process.env.VITE_CLOUD_TARGET ?? 'http://127.0.0.1:8180',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cloud/, ''),
      },
      '/edge': {
        target: process.env.VITE_EDGE_TARGET ?? 'http://127.0.0.1:8181',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/edge/, ''),
      },
    },
  },
}
