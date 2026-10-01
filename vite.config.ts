/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Prevent Vite from clearing the screen so Tauri/Rust logs stay visible.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'esnext',
    // 'oxc', not 'esbuild': Vite 8 builds on Rolldown and no longer ships
    // esbuild as a dependency, so asking for the esbuild minifier fails the
    // build outright with "Failed to load `transformWithEsbuild`" — the option
    // is still in the types, which is what makes it a trap. oxc is the
    // minifier Rolldown is built around, so it needs no extra install.
    minify: 'oxc',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Manual vendor splitting. The export libraries — jspdf, svg2pdf.js and
        // html2canvas — are dynamic-imported in exportImage.ts and land in their
        // own chunks, so they are not what makes the main chunk large: left
        // unsplit, the main chunk carries the app plus every vendor module
        // (~601 kB). Splitting the vendors out keeps the code that must be
        // re-fetched on an app update small and brings the bundle under the size
        // warning honestly, rather than by raising `chunkSizeWarningLimit` to
        // mute it.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Returning undefined is the right answer for everything else: these
          // libraries are reached from a dynamic import in exportImage.ts, and
          // naming a chunk for them here would fold them back into one eager
          // bucket. A catch-all `return 'vendor'` does exactly that, and the one
          // bucket it produces reaches 828 kB — which is why each group below is
          // named separately.
          if (id.includes('react-dom') || /node_modules\/react\//.test(id)) return 'vendor-react';
          if (id.includes('@radix-ui')) return 'vendor-icons';
          if (id.includes('zustand') || id.includes('immer')) return 'vendor-state';
          if (id.includes('d3-')) return 'vendor-d3';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
