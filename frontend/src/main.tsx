import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createQueryClient, Providers } from "./app/providers";
import { createAppRouter } from "./app/router";
import "./index.css";

// the theme is applied before first paint by public/theme-boot.js (cached per-account choice)
// A chunk from an older build is gone (app updated while cached): reload once to get the new index.
window.addEventListener("vite:preloadError", (event) => {
  if (sessionStorage.getItem("chunk-reload")) return;
  sessionStorage.setItem("chunk-reload", "1");
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("chunk-reload"), 10_000));

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
