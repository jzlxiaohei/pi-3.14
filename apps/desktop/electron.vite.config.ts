import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import solid from "vite-plugin-solid";

/**
 * Module format policy (Electron 42 + "type": "module" + sandbox: true)
 *
 * - main: ESM (`.js`) — Node ESM loader
 * - preload: CJS (`.cjs`) — sandboxed preload cannot execute ESM `import`
 * - renderer: Vite client ESM; avoid CJS-only npm trees (prefer marked over
 *   solid-markdown/unified for markdown)
 *
 * PI host runs in utilityProcess via `import "./pi/host-process?modulePath"`
 * (electron-vite resolves the entry; do not guess `.js` / `.mjs` at runtime).
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          inlineDynamicImports: true
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [solid()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src")
      }
    },
    build: {
      outDir: resolve(__dirname, "out/renderer")
    }
  }
});
