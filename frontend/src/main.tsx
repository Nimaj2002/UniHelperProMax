import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createQueryClient, Providers } from "./app/providers";
import { createAppRouter } from "./app/router";
import { applyTheme, systemTheme } from "./app/theme";
import "./index.css";

// set the theme before first paint to avoid a flash of the wrong theme
applyTheme(systemTheme());

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
