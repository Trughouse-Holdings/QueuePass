import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const shared = (p: string): string =>
  new URL(`../packages/shared/src/${p}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5174 },
  preview: { host: '0.0.0.0', port: 5174 },
  resolve: {
    // Exact-match aliases: a plain '@queuepass/shared' key would also capture '/web' as a prefix.
    alias: [
      { find: /^@queuepass\/shared$/, replacement: shared('index.ts') },
      { find: /^@queuepass\/shared\/web$/, replacement: shared('web/index.ts') },
      { find: /^@queuepass\/shared\/theme\.css$/, replacement: shared('web/theme.css') },
    ],
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
});
