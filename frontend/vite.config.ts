import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  // pdf.js loads lazily with the first document tab; pre-bundle it so the dev server doesn't
  // re-optimize (and reload the page) at that moment
  optimizeDeps: { include: ["pdfjs-dist", "pdfjs-dist/web/pdf_viewer.mjs"] },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://localhost:${process.env.UNIHELPER_API_PORT ?? 8000}`, changeOrigin: false },
    },
  },
});
