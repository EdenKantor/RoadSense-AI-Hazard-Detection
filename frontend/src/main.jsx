/**
 * Vite entry point.
 *
 * Mounts <App /> into #root in StrictMode and imports every global
 * stylesheet (base, layout, components, map, per-page styles, responsive)
 * once at app bootstrap so they are bundled in the correct cascade order.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/map.css";
import "./styles/pages/landing.css";
import "./styles/pages/auth.css";
import "./styles/pages/citizen.css";
import "./styles/pages/admin.css";
import "./styles/pages/authority.css";
import "./styles/pages/dev-pipeline-monitor.css";
import "./styles/responsive.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
