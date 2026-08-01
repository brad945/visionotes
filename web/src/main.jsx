import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import ThemeProvider from "./theme/ThemeProvider";
import AuthProvider from "./auth/AuthProvider";
import App from "./App";
import { installRafShim } from "./dev/rafShim";
import "./styles/base.css";

// Must run before the app mounts: HeroField captures requestAnimationFrame when
// its effect first runs. No-op unless DEV *and* ?rafshim=1.
installRafShim();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
