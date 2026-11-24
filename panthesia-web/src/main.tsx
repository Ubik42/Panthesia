/* The cascade layer order must be declared before any other stylesheet is injected. */
import "./layers.css";
import "./tokens.css";
import "./ui/desktop.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./ui/legacy/legacyBase.css";
createRoot(document.getElementById("root")!).render(<App />);

