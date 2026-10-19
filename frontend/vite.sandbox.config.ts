import path from "node:path";
import { defineConfig } from "vite";

/**
 * 013: the diagram renderer frame's script, built as one classic (IIFE) file into
 * public/sandbox/. The frame has an opaque origin, so it can't load module scripts from the app
 * without CORS; a classic script needs none. Built before `dev` and `build`.
 */
export default defineConfig({
  publicDir: false,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: {
    outDir: "public/sandbox",
    emptyOutDir: true,
    copyPublicDir: false,
    target: "es2022",
    minify: true,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/sandbox/diagramRenderer.ts"),
      name: "UhDiagramRenderer",
      formats: ["iife"],
      fileName: () => "diagram-renderer.js",
    },
  },
});
