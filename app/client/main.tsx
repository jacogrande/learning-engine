import { createRoot } from "react-dom/client";
import { App } from "./App";
// Atkinson Hyperlegible, a reading-font choice in the Aa menu; bundled so it works offline. The browser
// fetches it only when that font is chosen.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/atkinson-hyperlegible/latin-700-italic.css";

createRoot(document.getElementById("root")!).render(<App />);
