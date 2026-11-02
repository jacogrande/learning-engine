// Lesson renderer: Markdown + :::directives + typed fences (quiz, mermaid). Fails per block, never per page.
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { visit } from "unist-util-visit";
import YAML from "yaml";
import { Quiz, type QuizSpec } from "./Quiz";

// :::name{attr=value} → <div data-directive="name" attr="value">
function directives() {
  return (tree: any) =>
    visit(tree, (node: any) => {
      if (node.type === "containerDirective" || node.type === "leafDirective") {
        node.data ??= {};
        node.data.hName = "div";
        node.data.hProperties = { "data-directive": node.name, ...node.attributes };
      }
    });
}

function Mermaid({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  // Re-render when the theme changes: the picker, or the system scheme under "system".
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const bump = () => setTheme((n) => n + 1);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    addEventListener("themechange", bump); mq.addEventListener("change", bump);
    return () => { removeEventListener("themechange", bump); mq.removeEventListener("change", bump); };
  }, []);
  useEffect(() => {
    let live = true;
    import("mermaid").then(async ({ default: m }) => {
      const t = document.documentElement.dataset.theme;
      m.initialize({ startOnLoad: false, theme: t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "neutral" });
      try {
        const { svg } = await m.render("m" + Math.random().toString(36).slice(2), src);
        if (live && ref.current) ref.current.innerHTML = svg;
      } catch (e) { if (live) setErr(String(e)); }
    });
    return () => { live = false; };
  }, [src, theme]);
  return err ? <pre className="block-error">{src}</pre> : <div className="mermaid" ref={ref} />;
}

function Fence({ lang, code, children }: { lang: string; code: string; children: ReactNode }) {
  if (lang === "mermaid") return <Mermaid src={code} />;
  if (lang === "quiz") {
    try { const spec = YAML.parse(code) as QuizSpec; return <Quiz key={spec.id} spec={spec} />; }
    catch { return <pre className="block-error">{code}</pre>; }
  }
  return <pre><code>{children}</code></pre>;
}

// Defined once at module scope: new component identities on each render would
// remount every quiz and drop focus from its inputs on every keystroke.
const plugins = [remarkGfm, remarkDirective, directives];
const components = {
  pre: ({ children }: any) => <>{children}</>,   // fences are handled in `code`
  code: ({ className, children, ...rest }: any) => {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    const code = String(children).replace(/\n$/, "");
    const inline = !className && !code.includes("\n");
    return inline ? <code {...rest}>{children}</code> : <Fence lang={lang ?? ""} code={code}>{children}</Fence>;
  },
  div: ({ node, children, ...props }: any) => {
    const kind = props["data-directive"];
    if (!kind) return <div {...props}>{children}</div>;
    return <aside className={`callout callout-${props.type ?? "note"}`} data-kind={kind}>{children}</aside>;
  },
};

export function Markdown({ body }: { body: string }) {
  return <ReactMarkdown remarkPlugins={plugins} components={components}>{body}</ReactMarkdown>;
}
