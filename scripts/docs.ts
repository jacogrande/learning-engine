// Minimal docs viewer: serves /docs as rendered markdown, preserving folders.
// Run with `bun run docs`.
import { marked } from "marked";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, extname, basename } from "node:path";

const DOCS_DIR = resolve(import.meta.dir, "..", "docs");
const PORT = Number(process.env.PORT ?? 4000);

type Node = { name: string; path: string; children?: Node[] };

async function tree(dir: string): Promise<Node[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: Node[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    const rel = relative(DOCS_DIR, full);
    if (e.isDirectory()) {
      const children = await tree(full);
      if (children.length) nodes.push({ name: e.name, path: rel, children });
    } else if (extname(e.name) === ".md") {
      nodes.push({ name: basename(e.name, ".md"), path: rel });
    }
  }
  // folders first, then files
  return nodes.sort((a, b) => Number(!!b.children) - Number(!!a.children));
}

function renderTree(nodes: Node[], current: string): string {
  return `<ul>${nodes
    .map((n) =>
      n.children
        ? `<li class="dir"><span>${n.name}</span>${renderTree(n.children, current)}</li>`
        : `<li><a href="/${n.path}"${n.path === current ? ' class="active"' : ""}>${n.name}</a></li>`,
    )
    .join("")}</ul>`;
}

function page(title: string, sidebar: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>
  // Apply saved theme before first paint to avoid a flash.
  (function () { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; })();
</script>
<style>
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #767676; --faint: #ececec; --hover: #f4f4f4; --code: #f6f6f6; --accent: #1a1a1a;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg: #111111; --fg: #e8e8e8; --muted: #8a8a8a; --faint: #262626; --hover: #1c1c1c; --code: #191919; --accent: #e8e8e8;
    color-scheme: dark;
  } }
  :root[data-theme="dark"] {
    --bg: #111111; --fg: #e8e8e8; --muted: #8a8a8a; --faint: #262626; --hover: #1c1c1c; --code: #191919; --accent: #e8e8e8;
    color-scheme: dark;
  }

  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; display: flex; min-height: 100vh; color: var(--fg); background: var(--bg);
         font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif;
         -webkit-font-smoothing: antialiased; }

  /* sidebar */
  nav { width: 240px; flex: none; display: flex; flex-direction: column; padding: 28px 20px 20px;
        border-right: 1px solid var(--faint); position: sticky; top: 0; height: 100vh; overflow-y: auto; font-size: 13.5px; }
  nav .brand { display: block; margin: 0 0 20px 8px; font-size: 13px; font-weight: 600; letter-spacing: .02em; color: var(--fg); text-decoration: none; }
  nav .tree { flex: 1; }
  nav ul { list-style: none; padding: 0; margin: 0; }
  nav ul ul { padding-left: 10px; }
  nav li.dir > span { display: block; margin: 14px 0 4px 8px; color: var(--muted); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .08em; }
  nav a { display: block; padding: 4px 8px; border-radius: 5px; color: var(--muted); text-decoration: none; }
  nav a:hover { color: var(--fg); background: var(--hover); }
  nav a.active { color: var(--fg); background: var(--hover); font-weight: 500; }

  /* theme switcher */
  .theme { display: flex; gap: 2px; margin-top: 20px; padding: 2px; border: 1px solid var(--faint); border-radius: 6px; width: max-content; }
  .theme button { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 4px; font-size: 11.5px; color: var(--muted); }
  .theme button:hover { color: var(--fg); }
  .theme button[aria-pressed="true"] { color: var(--fg); background: var(--hover); }

  /* content */
  main { flex: 1; min-width: 0; padding: 56px 64px 120px; max-width: 760px; }
  main > :first-child { margin-top: 0; }
  main h1 { font-size: 30px; line-height: 1.2; letter-spacing: -.02em; margin: 0 0 24px; }
  main h2 { font-size: 20px; line-height: 1.3; letter-spacing: -.01em; margin: 48px 0 12px; }
  main h3 { font-size: 16px; margin: 32px 0 8px; }
  main h4 { font-size: 14.5px; margin: 24px 0 6px; }
  main p, main ul, main ol { margin: 0 0 16px; }
  main li { margin: 4px 0; }
  main a { color: var(--accent); text-decoration: underline; text-decoration-color: var(--muted); text-decoration-thickness: 1px; text-underline-offset: 3px; }
  main a:hover { text-decoration-color: var(--accent); }
  main hr { border: 0; border-top: 1px solid var(--faint); margin: 40px 0; }
  main pre { background: var(--code); border-radius: 6px; padding: 14px 16px; overflow-x: auto; font-size: 13px; line-height: 1.55; margin: 0 0 20px; }
  main code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .88em; }
  main :not(pre) > code { background: var(--code); padding: .15em .4em; border-radius: 4px; }
  main table { border-collapse: collapse; width: 100%; font-size: 14px; display: block; overflow-x: auto; margin: 0 0 24px; }
  main th, main td { padding: 8px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--faint); }
  main th { font-weight: 600; color: var(--muted); font-size: 12.5px; text-transform: uppercase; letter-spacing: .04em; }
  main blockquote { margin: 0 0 16px; padding-left: 16px; border-left: 2px solid var(--faint); color: var(--muted); }
  main img { max-width: 100%; border-radius: 6px; }
  main strong { font-weight: 600; }

  @media (max-width: 760px) {
    body { flex-direction: column; }
    nav { width: auto; height: auto; position: static; border-right: 0; border-bottom: 1px solid var(--faint); padding: 20px 16px; }
    main { padding: 32px 16px 80px; }
  }
</style>
</head>
<body>
<nav>
  <a class="brand" href="/">Docs</a>
  <div class="tree">${sidebar}</div>
  <div class="theme" role="group" aria-label="Theme">
    <button data-theme="system">System</button><button data-theme="light">Light</button><button data-theme="dark">Dark</button>
  </div>
</nav>
<main>${body}</main>
<script>
  (function () {
    var buttons = document.querySelectorAll(".theme button");
    function sync() {
      var t = localStorage.getItem("theme") || "system";
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.theme === t)); });
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        var t = b.dataset.theme;
        if (t === "system") { localStorage.removeItem("theme"); delete document.documentElement.dataset.theme; }
        else { localStorage.setItem("theme", t); document.documentElement.dataset.theme = t; }
        sync();
      });
    });
    sync();
  })();
</script>
</body>
</html>`;
}

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".pdf": "application/pdf",
  ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain",
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const full = resolve(DOCS_DIR, rel);
    if (!full.startsWith(DOCS_DIR)) return new Response("Forbidden", { status: 403 });

    const nodes = await tree(DOCS_DIR);

    // Index: list of docs
    if (rel === "") {
      const body = `<h1>Docs</h1><p>${nodes.length ? "Pick a document from the sidebar." : "No markdown files in <code>docs/</code> yet."}</p>`;
      return new Response(page("docs", renderTree(nodes, ""), body), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    let info;
    try { info = await stat(full); } catch { return new Response("Not found", { status: 404 }); }
    if (info.isDirectory()) return Response.redirect("/", 302);

    if (extname(full) === ".md") {
      const md = await Bun.file(full).text();
      const html = await marked.parse(md, { gfm: true });
      return new Response(page(basename(rel, ".md"), renderTree(nodes, rel), html), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Static assets (images etc.) referenced from markdown
    return new Response(Bun.file(full), {
      headers: { "content-type": MIME[extname(full)] ?? "application/octet-stream" },
    });
  },
});

console.log(`Docs: http://localhost:${PORT}  (serving ${relative(process.cwd(), DOCS_DIR) || "docs"})`);
