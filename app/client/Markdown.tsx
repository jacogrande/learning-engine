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
  useEffect(() => {
    let live = true;
    import("mermaid").then(async ({ default: m }) => {
      m.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral" });
      try {
        const { svg } = await m.render("m" + Math.random().toString(36).slice(2), src);
        if (live && ref.current) ref.current.innerHTML = svg;
      } catch (e) { if (live) setErr(String(e)); }
    });
    return () => { live = false; };
  }, [src]);
  return err ? <pre className="block-error">{src}</pre> : <div className="mermaid" ref={ref} />;
}

function Fence({ lang, code, children }: { lang: string; code: string; children: ReactNode }) {
  if (lang === "mermaid") return <Mermaid src={code} />;
  if (lang === "quiz") {
    try { return <Quiz spec={YAML.parse(code) as QuizSpec} />; }
    catch { return <pre className="block-error">{code}</pre>; }
  }
  return <pre><code>{children}</code></pre>;
}

export function Markdown({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkDirective, directives]}
      components={{
        pre: ({ children }) => <>{children}</>,   // fences are handled in `code`
        code: ({ className, children, ...rest }) => {
          const lang = /language-(\w+)/.exec(className ?? "")?.[1];
          const code = String(children).replace(/\n$/, "");
          const inline = !className && !code.includes("\n");
          return inline ? <code {...rest}>{children}</code> : <Fence lang={lang ?? ""} code={code}>{children}</Fence>;
        },
        div: ({ node, children, ...props }) => {
          const kind = (props as any)["data-directive"];
          if (!kind) return <div {...props}>{children}</div>;
          const type = (props as any).type ?? "note";
          return <aside className={`callout callout-${type}`} data-kind={kind}>{children}</aside>;
        },
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
