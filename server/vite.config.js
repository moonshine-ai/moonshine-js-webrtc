// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 80,
    host: true,
    allowedHosts: true,
  },
});
