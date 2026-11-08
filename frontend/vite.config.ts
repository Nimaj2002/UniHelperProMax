import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// 024: the demo build (`--mode demo`) needs MSW's Service Worker script at the site root. It is
// served/emitted here instead of living in public/, so normal builds never contain it.
function demoServiceWorker(): Plugin {
  const file = path.resolve(import.meta.dirname, "node_modules/msw/lib/mockServiceWorker.js");
  return {
    name: "unihelper-demo-sw",
    configureServer(server) {
      server.middlewares.use("/mockServiceWorker.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "mockServiceWorker.js", source: readFileSync(file) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    plugins: [react(), tailwindcss(), ...(demo ? [demoServiceWorker()] : [])],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    build: demo ? { outDir: "dist-demo" } : undefined,
    // the reader (EmbedPDF) loads lazily with the first document tab; pre-bundle it so the dev
    // server doesn't re-optimize (and reload the page) at that moment
    optimizeDeps: {
      include: [
        "@embedpdf/react-pdf-viewer",
        "@embedpdf/core/react",
        "@embedpdf/engines/pdfium-worker-engine",
        "@embedpdf/models",
        "@embedpdf/plugin-document-manager/react",
        "@embedpdf/plugin-interaction-manager/react",
        "@embedpdf/plugin-render/react",
        "@embedpdf/plugin-scroll/react",
        "@embedpdf/plugin-search/react",
        "@embedpdf/plugin-selection/react",
        "@embedpdf/plugin-tiling/react",
        "@embedpdf/plugin-viewport/react",
        "@embedpdf/plugin-zoom/react",
        // 013: diagrams and math load with the first note that has one
        "katex",
        "mermaid",
        "dompurify",
        "lexical",
        "@lexical/utils",
        "@lexical/react/LexicalComposerContext",
        "@lexical/react/useLexicalNodeSelection",
        "mdast-util-from-markdown",
        ...(demo ? ["msw/browser", "msw"] : []),
      ],
    },
    server: demo
      ? { port: 5174 }
      : {
          port: 5173,
          proxy: {
            "/api": { target: `http://localhost:${process.env.UNIHELPER_API_PORT ?? 8000}`, changeOrigin: false },
          },
        },
  };
});
