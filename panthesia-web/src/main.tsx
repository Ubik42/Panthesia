/* The cascade layer order must be declared before any other stylesheet is injected. */
import "./layers.css";
import "./tokens.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app/workspaces.css";
import "./style.css";
import "./features/practice/practiceWorkspace.css";
import "./app/browseDetailWorkspace.css";
import "./features/fingering/fingeringWorkspace.css";
import "./features/practice/pianoVisual.css";
import "./features/practice/practiceChrome.css";
import "./app/dailyTheme.css";
createRoot(document.getElementById("root")!).render(<App />);

import "./features/practice/synthesiaLayout.css";

import "./features/screens/productScreens.css";
