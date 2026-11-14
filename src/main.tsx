import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

// Register Progressive Web App (PWA) Service Worker safely (Web/PWA only; disabled inside Tauri desktop app)
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const isTauriDesktop =
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    window.location.hostname === "tauri.localhost" ||
    window.location.protocol === "tauri:";

  if (isTauriDesktop) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  } else if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let refreshed = false;
      if (hadController) {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!refreshed) {
            refreshed = true;
            window.location.reload();
          }
        });
      }

      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch((err) => {
          console.warn("[PWA] Service worker registration failed:", err);
        });
    });
  }
}
