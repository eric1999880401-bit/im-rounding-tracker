import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/global.css";
import "./styles/print.css";

if (window.location.hostname === "127.0.0.1") {
  const localUrl = new URL(window.location.href);
  localUrl.hostname = "localhost";
  window.location.replace(localUrl);
} else {
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
}
