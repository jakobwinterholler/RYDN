import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installClientErrorReporting } from "./telemetry";
import {
  installStylesheetRecovery,
  purgeServiceWorkersInDev,
  registerProductionServiceWorker,
} from "./swClient";
import "./styles.css";

installClientErrorReporting();

if (import.meta.env.DEV) {
  // Tunnel origin often shared with a prior production SW — clear it so Vite CSS loads.
  void purgeServiceWorkersInDev();
} else {
  installStylesheetRecovery();
  window.addEventListener("load", () => {
    void registerProductionServiceWorker();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
