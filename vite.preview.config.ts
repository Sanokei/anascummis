import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * The design preview build.
 *
 * Separate from the app's own config for two reasons. It writes to its own
 * directory, so it can never be mistaken for a deployable artifact — the preview
 * is a way to look at the design, not something that ships. And it disables code
 * splitting and asset hashing so the output is one script and one stylesheet,
 * which is what makes it possible to fold the whole thing into a single file and
 * put it somewhere a person can open it without a server.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/preview',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./preview.html', import.meta.url)),
      output: {
        entryFileNames: 'preview.js',
        assetFileNames: 'preview.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
});
