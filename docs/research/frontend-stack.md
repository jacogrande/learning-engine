# Research: Frontend and content stack

Research date: 2026-10-27. Versions pulled from the npm registry that day unless noted.

## Version snapshot

| Package | Latest | Notes |
|---|---|---|
| `vite` | 8.3.5 | Rolldown-based since 8.0 |
| `next` | 16.4.3 | Turbopack default |
| `@tanstack/react-start` | 1.169.4 | 1.0 declared stable 2026-10-13 |
| `hono` / `@hono/node-server` / `@hono/node-ws` | 4.13.14 / 2.1.5 / 1.3.1 | |
| `chokidar` | 6.0.0 (2026-10-19) | Node ≥ 22.22, ESM-only; v5 is the conservative pick |
| `@mdx-js/mdx` | 3.1.1 | runtime `evaluate()` exists but uses eval |
| `react-markdown` | 10.1.0 | |
| `remark-directive` | 4.0.0 | `:::container`, `::leaf`, `:inline` directives |
| `streamdown` | 2.7.1 | streaming-safe markdown renderer (Vercel) |
| `@tiptap/core` / `@tiptap/markdown` | 3.32.0 | official bidirectional markdown (Oct 2025) |
| `tiptap-markdown` (community) | 0.9.0 | maintainer: no further work |
| `@milkdown/crepe` | 7.23.0 | markdown-native WYSIWYG alternative |
| `@blocknote/core` / `lexical` / `platejs` | 0.56 / 0.52 / 53.3 | |
| `@recogito/text-annotator` + `react-text-annotator` | 4.3.7 | maintained, W3C-aligned |
| `web-highlighter` | 0.8.0 | DOM-path anchoring (fragile under re-render) |
| `dom-anchor-text-quote` / `@annotator/dom` | 2017 / 2021 | dormant; copy ideas, don't depend |
| `@floating-ui/react` | 0.27.20 | |
| `react-resizable-panels` | 4.15.0 | shadcn `Resizable` wraps it |
| `mermaid` | 12.2.0 (11.16 also current) | v12 breaking changes unverified |
| `vega-lite` / `vega-embed` | 6.5.0 / 7.3.0 | |
| `chart.js` | 4.6.1 | |
| `ai` / `@ai-sdk/react` | 7.0.155 / 4.0.159 | ESM-only, Node ≥ 22 |
| `@assistant-ui/react` | 0.15.31 | |
| `@anthropic-ai/claude-agent-sdk` | 0.3.312 | |

## 1. Lesson content format

The LatentMD benchmark ([arXiv 2609.06993](https://deeplearn.org/arxiv/822582/latentmd:-benchmarking-markdown-boundary-failures-in-llm-generated-text)) found 38% of content-correct LLM outputs were "boundary-broken" (unclosed fences, delimiter collisions). Formats that depend on balanced, meaningful syntax (JSX, JS expressions) fail whole-document; formats that degrade per block don't.

| Format | Runtime load | Failure mode | Verdict |
|---|---|---|---|
| **MDX** | `@mdx-js/mdx` `evaluate()`/`run()` (eval-based, trusted content only); `next-mdx-remote`, `mdx-bundler` wrap it | One stray `<`, `{`, or unclosed tag → whole lesson renders nothing | Most expressive, least robust for machine-written files |
| **Markdown + `remark-directive` + typed fences** | `react-markdown` v10 or `unified` directly, string in → React tree out | Malformed directive degrades to a paragraph; bad fence shows an error card | **Recommended** |
| Raw HTML | `rehype-raw` / `dangerouslySetInnerHTML` | forgiving but loses structure (headings, quiz semantics) | escape hatch only |
| JSON blocks (Portable Text, Tiptap JSON) | `@portabletext/react`, Tiptap static renderer | one JSON error kills the doc; ugly for humans; worse prose | only if strict schema validation matters more than readability |

Suggested lesson grammar:

````markdown
---
id: 01HXYZ...
title: Gradient descent
module: 03
---
## Intuition {#sec_01HX...}

:::callout{type=tip}
...
:::

```mermaid
flowchart LR ...
```

```vega-lite
{ "mark": "line", "data": {...}, "encoding": {...} }
```

```quiz
id: q_01HX...
type: short-answer
question: ...
rubric: ...
```
````

Fenced data blocks with YAML/JSON bodies are the most reliable thing LLMs emit; validate with zod and render an error card on failure without breaking the page. MDX team's own guidance: use remark/rehype plugins when you only want custom syntax, not JSX ([discussion](https://github.com/mdx-js/mdx/discussions/2357)).

## 2. App framework

| Framework | Fit |
|---|---|
| **Vite + React SPA + Hono (Node)** | Least machinery. You own the server: `child_process.spawn`, chokidar, Hono `streamSSE`, `@hono/node-ws`. **Recommended.** |
| TanStack Start 1.0 | One tree with file routes and server functions; runner-up |
| Next.js 16 | SSE from route handlers has buffering gotchas; no native WS; RSC/caching friction for a localhost tool |
| SvelteKit 3 | fine, but the editor/annotation/chat ecosystem is React-first |
| Astro 7 | great for content sites; app with three stateful panes ends up as one big React island anyway |

Run Vite in middleware mode inside the Hono server if you want one process.

## 3. File watching and live reload

Pick **server-side watch → SSE push → client refetch**: `chokidar.watch(contentDir, { awaitWriteFinish, atomic: true })` → debounce → `GET /api/events` SSE emits `{type:'content', docId}` → TanStack Query invalidates. Works identically in dev and built, ~40 lines. Vite HMR custom events and `import.meta.glob` both couple content to the bundler.

## 4. Selection menu and durable highlights

- Floating menu: `@floating-ui/react` with a virtual element (`getBoundingClientRect: () => range.getBoundingClientRect()`, `getClientRects`) plus the `inline` middleware for multi-line selections ([docs](https://floating-ui.com/docs/virtual-elements)). Ready-made shadcn-style versions: DiceUI Selection Toolbar, assistant-ui `SelectionToolbar`. `react-selection-popover` is dead (2016).
- Heading ellipsis: override `components.h2/h3` in react-markdown and render a shadcn `DropdownMenu` trigger on hover.
- Anchoring: store W3C Web Annotation selectors — `TextQuoteSelector` (exact/prefix/suffix) primary, `TextPositionSelector` fast path, plus doc/block id and content hash. Re-anchor on render: position first, quote fallback, fuzzy fallback (Hypothesis order, [fuzzy anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/)).
- Painting: **CSS Custom Highlight API** (`CSS.highlights.set(name, new Highlight(range))` + `::highlight(name)`) paints ranges without mutating the React DOM, so re-renders can't orphan `<mark>` wrappers. Support (from memory, verify): Chrome 105+, Safari 17.2+, Firefox 140+.
- Off-the-shelf: `@recogito/text-annotator` 4.x is the only maintained W3C-shaped option. Writing ~150 lines yourself gives full control over `selectionchange` (needed because the action menu also uses it).

## 5. Notes editor

**Tiptap 3 + `@tiptap/markdown`** (official, uses `marked`): `editor.getMarkdown()`, `setContent(md, { contentType: 'markdown' })`. Persist notes as markdown files on disk (agent-readable) with debounced save; Tiptap JSON optionally for nodes markdown can't express. "Add to Note" inserts a blockquote carrying the annotation id in a data attribute. The same editor serves the end-of-module "summarize" task.

Alternatives: Milkdown Crepe (markdown is the source of truth by construction), BlockNote (lossy markdown export, block JSON preferred), Lexical (low-level, 0.x), Plate (heavy), CodeMirror 6 (raw markdown).

## 6. Charts and diagrams

| Format | Verdict |
|---|---|
| **Mermaid** | the format LLMs know best; `mermaid.parse()` to validate before `render()`; show source on failure. Pin 11.x or verify 12.x |
| **Vega-Lite** (JSON) | best for data charts; lazy-load (~1 MB); fails per block |
| Chart.js (JSON config) | lighter fallback for simple charts |
| Observable Plot, Recharts, D3 | need JS/JSX → inherit MDX fragility; skip |
| Excalidraw JSON | verbose, bad layouts; skip |

## 7. Chat UI

Tokens come from Claude Code stream-json (`stream_event` → `content_block_delta` → `text_delta`), not a model API.

1. **Vercel AI SDK `useChat`** is backend-agnostic: it consumes the UI Message Stream protocol (SSE of JSON parts `start`, `text-delta`, `tool-input-available`, `finish`, …; header `x-vercel-ai-ui-message-stream: v1`; [protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)). Your Hono route maps Claude Code events to these parts; tool calls map to tool parts so the UI can show "Reading lesson 3…".
2. **assistant-ui** adds polished primitives via `ExternalStoreRuntime`; still 0.x.
3. **Hand-rolled** fetch + ReadableStream + `streamdown`, ~100 lines.

Render streaming markdown with **`streamdown`** (repairs unterminated blocks, memoizes closed blocks, Mermaid/KaTeX plugins). Reuse the same `components` map in chat and reading pane.

## 8. UI kit and layout

shadcn/ui + Tailwind v4; `Resizable` (react-resizable-panels v4) with `autoSaveId` for persisted pane sizes; collapsible left nav; center `ScrollArea`; right panel toggles Notes/Chat with both kept mounted to preserve editor and chat state.

## Recommended stack

```
app/
  client/   Vite 8 + React 19 + TS, Tailwind v4, shadcn/ui, react-resizable-panels 4
  server/   Hono 4 on @hono/node-server (Node 22+), chokidar, claude CLI bridge
  content/  courses/**/*.md   (written by the agent)
  data/     SQLite + notes/*.md
```

The two decisions that matter most: (1) don't use MDX for machine-written content; (2) keep content reload server-side, not on Vite HMR.

## Sources

MDX: [mdxjs.com](https://mdxjs.com/packages/mdx/), [LatentMD](https://deeplearn.org/arxiv/822582/latentmd:-benchmarking-markdown-boundary-failures-in-llm-generated-text) · Markdown: [remark-directive](https://npmjs.com/package/remark-directive), [remark-directive-rehype](https://unifiedjs.com/explore/package/remark-directive-rehype) · Frameworks: [TanStack Start 1.0](https://tanstack.com/blog/announcing-tanstack-start-v1), [Next 16](https://nextjs.org/docs/app/guides/upgrading/version-16), [Hono WS](https://www.mintlify.com/honojs/hono/helpers/websocket) · Watching: [chokidar 6](https://newreleases.io/project/npm/chokidar/release/6.0.0), [Vite HMR](https://vite.dev/guide/api-hmr.html) · Selection: [Floating UI virtual elements](https://floating-ui.com/docs/virtual-elements), [recogito/text-annotator-js](https://github.com/recogito/text-annotator-js), [Apache Annotator](https://annotator.apache.org/docs/getting-started) · Editors: [Tiptap markdown](https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap), [Milkdown Crepe](https://npmjs.com/package/@milkdown/crepe), [BlockNote export](https://www.blocknotejs.org/docs/features/export/markdown) · Charts: [mermaid render](https://www.mintlify.com/mermaid-js/mermaid/api/methods/render), [vega-embed](https://github.com/vega/vega-embed) · Chat: [AI SDK stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol), [streamdown](https://github.com/vercel/streamdown), [assistant-ui external store](https://www.assistant-ui.com/docs/runtimes/custom/external-store) · UI: [shadcn resizable](https://ui.shadcn.com/docs/components/resizable)
