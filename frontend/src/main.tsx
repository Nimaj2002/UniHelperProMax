import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createQueryClient, Providers } from "./app/providers";
import { createAppRouter } from "./app/router";
import "./index.css";

// the theme is applied before first paint by public/theme-boot.js (cached per-account choice)
const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
