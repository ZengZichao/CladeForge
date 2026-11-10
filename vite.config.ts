// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// Single source of truth for the application version: package.json is read once
// here and injected as the `__APP_VERSION__` global (src/model/types.ts consumes
// it), so the UI, exports and stored analysis results all stamp the same version
// the release pipeline publishes.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// GitHub Pages project sites are served from /<repo>/, not the domain root;
// every asset URL in the built index.html must carry this prefix or the
// deployed page 404s on its own JS/CSS.
//
// The Tauri desktop app, however, loads the SAME dist/ through its custom
// protocol at the ROOT (tauri://localhost/index.html), so absolute
// `/CladeForge/assets/...` URLs 404 there and the window renders BLANK. The
// Tauri CLI exports TAURI_ENV_* to every hook it runs (beforeDevCommand /
// beforeBuildCommand), so detecting that variable keeps the desktop bundle at
// the root while the Pages build — run without it — keeps the project prefix.
const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: isTauriBuild ? '/' : '/CladeForge/',
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
        // Manual vendor splitting. The export libraries — jspdf and svg2pdf.js —
        // are dynamic-imported in exportImage.ts (jspdf in turn loads html2canvas
        // lazily) and land in their own chunks, so they are not what makes the main chunk large: left
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
    // `__APP_VERSION__` reaches the tests through the TOP-LEVEL `define` above
    // (Vitest processes the same config through Vite). Vitest 4's own
    // `test.define` slot no longer exists in its config types.
    //
    // Coverage is OPT-IN (`npm run test:coverage`) and deliberately carries no
    // thresholds: the scientific-correctness review is explicit that coverage
    // is a gap VISUALISER, never a gate — the scientific oracles (independent
    // enumerations, hand-computed anchors, exact repro values) are what
    // actually verify correctness, and a percentage cannot.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      // Test files and the ambient declarations measure nothing.
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
