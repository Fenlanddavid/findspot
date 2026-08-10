import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyIOSFocusZoomPolicy } from "./utils/iosViewportPolicy";
import { reportNonFatal } from "./services/diagLog";

applyIOSFocusZoomPolicy();

async function clearDevelopmentServiceWorkers(): Promise<boolean> {
  if (!import.meta.env.DEV || !("serviceWorker" in navigator)) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const controlledByDevelopmentWorker = registrations.some(registration =>
    [registration.active, registration.waiting, registration.installing]
      .some(worker => worker?.scriptURL.includes('/dev-sw.js'))
  );
  await Promise.all(registrations.map(registration => registration.unregister()));
  return controlledByDevelopmentWorker && navigator.serviceWorker.controller !== null;
}

async function start(): Promise<void> {
  try {
    if (await clearDevelopmentServiceWorkers()) {
      window.location.reload();
      return;
    }
  } catch (error) {
    reportNonFatal('startup', 'Could not clear development service workers', error);
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void start();
