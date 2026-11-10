// Dev server for automated playtests: no hot reload, so edits by one tester never reload another tester's page.
import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { hmr: false }, build: { chunkSizeWarningLimit: 1500 } });
