import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const shared = (p: string): string =>
  new URL(`../packages/shared/src/${p}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
  },
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
