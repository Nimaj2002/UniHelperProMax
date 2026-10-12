import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
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
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://localhost:${process.env.UNIHELPER_API_PORT ?? 8000}`, changeOrigin: false },
    },
  },
});
