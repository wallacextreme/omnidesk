import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Register Progressive Web App (PWA) Service Worker
if (typeof window !== "undefined" && "serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[PWA] Service worker registration failed:", err);
    });
  });
}
