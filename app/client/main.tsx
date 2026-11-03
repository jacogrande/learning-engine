import { createRoot } from "react-dom/client";
import { App } from "./App";
// Atkinson Hyperlegible, a reading-font choice in the Aa menu; bundled so it works offline. The browser
// fetches it only when that font is chosen.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/atkinson-hyperlegible/latin-700-italic.css";

// Browsers without CSS field-sizing: grow a textarea to its text as it is typed in (styles.css caps it).
if (!CSS.supports("field-sizing", "content"))
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t instanceof HTMLTextAreaElement) { t.style.height = "auto"; t.style.height = `${t.scrollHeight + t.offsetHeight - t.clientHeight}px`; }
  });

createRoot(document.getElementById("root")!).render(<App />);
