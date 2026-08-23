import React from "react";
import ReactDOM from "react-dom/client";
import { WindowRoot } from "./WindowRoot.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WindowRoot />
  </React.StrictMode>
);
