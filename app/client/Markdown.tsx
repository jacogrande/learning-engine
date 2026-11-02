// Lesson renderer: Markdown + :::directives + typed fences (quiz, mermaid, abc). Fails per block, never per page.
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { visit } from "unist-util-visit";
import YAML from "yaml";
import { Quiz, type QuizSpec } from "./Quiz";

// :::name{attr=value} → <div data-directive="name" attr="value">
// Inline `:name` is also directive syntax, which swallows ordinary prose like a timestamp ("at 1:43")
// or a ratio; those are put back as the literal text they were.
function directives() {
  return (tree: any) =>
    visit(tree, (node: any) => {
      if (node.type === "containerDirective" || node.type === "leafDirective") {
        node.data ??= {};
        node.data.hName = "div";
        node.data.hProperties = { "data-directive": node.name, ...node.attributes };
      } else if (node.type === "textDirective") {
        const label = (node.children ?? []).map((c: any) => c.value ?? "").join("");
        node.type = "text";
        node.value = `:${node.name}${label ? `[${label}]` : ""}`;
        delete node.children;
      }
    });
}

// Notes keep underline and coloured highlight as two inline HTML tags, <u> and
// <mark data-color="…">, since markdown has neither. Only those become elements; every other raw
// HTML tag is still dropped.
const OPEN = /^<(u|mark)(?:\s+data-color="([a-z]+)")?>$/i, CLOSE = /^<\/(u|mark)>$/i;
function inlineMarks() {
  const fold = (node: any) => {
    if (!Array.isArray(node.children)) return;
    const out: any[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i], open = c.type === "html" ? OPEN.exec(c.value) : null;
      const end = open ? node.children.findIndex((x: any, k: number) => k > i && x.type === "html" && CLOSE.exec(x.value)?.[1].toLowerCase() === open[1].toLowerCase()) : -1;
      if (!open || end < 0) { out.push(c); continue; }
      const tag = open[1].toLowerCase();
      out.push({ type: "inlineMark", children: node.children.slice(i + 1, end), data: { hName: tag, hProperties: tag === "mark" ? { className: `hl hl-${open[2] ?? "yellow"}` } : {} } });
      i = end;
    }
    node.children = out;
    out.forEach(fold);
  };
  return fold;
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
      m.initialize({ startOnLoad: false, theme: t === "dark" || (t !== "light" && t !== "sepia" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "neutral" });
      try {
        const { svg } = await m.render("m" + Math.random().toString(36).slice(2), src);
        if (live && ref.current) ref.current.innerHTML = svg;
      } catch (e) { if (live) setErr(String(e)); }
    });
    return () => { live = false; };
  }, [src, theme]);
  return err ? <pre className="block-error">{src}</pre> : <div className="mermaid" ref={ref} />;
}

// ```abc fences: staff notation written in ABC, engraved by abcjs, with a player when the
// browser can synthesize audio. The soundfont streams from abcjs's default CDN on first play.
function Abc({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true, ctl: { pause(): void } | null = null;
    import("abcjs").then((mod) => {
      const abc: typeof mod = (mod as any).default?.renderAbc ? (mod as any).default : mod;   // CJS interop varies by bundler
      if (!live || !ref.current) return;
      try {
        const [tune] = abc.renderAbc(ref.current, src, {
          responsive: "resize", add_classes: true, foregroundColor: "currentColor", selectionColor: "var(--accent)",
          paddingtop: 0, paddingbottom: 0, paddingleft: 0, paddingright: 0,
        });
        if (!tune || !tune.lines.length) throw new Error("No music in abc block");
        if (tune.warnings?.length) console.warn("abc:", tune.warnings.join("\n"));
        if (audio.current && abc.synth.supportsAudio()) {
          const controller = new abc.synth.SynthController();
          ctl = controller;
          let lit: Element[] = [];
          const clear = () => { lit.forEach((e) => e.classList.remove("is-playing")); lit = []; };
          controller.load(audio.current, {
            onEvent: (ev) => { clear(); lit = (ev.elements ?? []).flat(); lit.forEach((e) => e.classList.add("is-playing")); },
            onFinished: clear,
          }, { displayPlay: true, displayProgress: true, displayRestart: true, displayLoop: true, displayWarp: true });
          controller.setTune(tune, false).catch((e: unknown) => console.warn("abc audio:", e));
        }
      } catch (e) { console.warn("abc:", e); setErr(String(e)); }
    });
    return () => { live = false; ctl?.pause(); };
  }, [src]);
  if (err) return <pre className="block-error">{src}</pre>;
  return <figure className="abc"><div className="abc-score" ref={ref} /><div className="abc-audio" ref={audio} /></figure>;
}

// ::youtube{v="id" t="1:43" end="1:49" title="…"} → a player for just that passage. YouTube's chrome is
// off; the bar below the frame has play, a reset that jumps back to `t`, a scrubber bounded by the
// passage, and the speed menu YouTube offers for the video. The nocookie host keeps YouTube from
// setting tracking cookies until the reader presses play.
const toSeconds = (t?: string) => String(t ?? "").split(":").map(Number).reduce((a, b) => a * 60 + b, 0) || 0;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
let ytApi: Promise<any> | null = null;   // the IFrame API script is loaded once per page
function loadYouTube(): Promise<any> {
  return ytApi ??= new Promise((resolve) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true; document.head.appendChild(s);
  });
}
function YouTube({ v, t, end, title }: { v?: string; t?: string; end?: string; title?: string }) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);                 // seconds into the passage
  const [stop, setStop] = useState(toSeconds(end));  // absolute end; the video's own end when `end` is absent
  const [rates, setRates] = useState<number[]>([1]);
  const [rate, setRate] = useState(1);
  const start = toSeconds(t), endAt = toSeconds(end);
  const valid = !!v && /^[\w-]{11}$/.test(v);
  useEffect(() => {
    if (!valid || !mount.current) return;
    let live = true, p: any = null, timer: ReturnType<typeof setInterval> | undefined;
    loadYouTube().then((YT) => {
      if (!live || !mount.current) return;
      p = new YT.Player(mount.current, {
        videoId: v, host: "https://www.youtube-nocookie.com",
        playerVars: { start, end: endAt || undefined, controls: 0, rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3, playsinline: 1, origin: location.origin },
        events: {
          onReady: () => {
            if (!live) return;
            player.current = p;
            const list: number[] = p.getAvailablePlaybackRates?.() ?? [1];
            setRates(list.length ? list : [1]);
            if (!endAt) setStop(p.getDuration() || 0);
            if (title) try { p.getIframe().title = title; } catch {}
            setReady(true);
            // Keep the passage's bounds ourselves: YouTube's `end` is dropped after a seek, and
            // letting the video run on would reach its end screen.
            timer = setInterval(() => {
              if (!player.current) return;
              const now = p.getCurrentTime?.() ?? start, over = endAt && now >= endAt;
              if (over && p.getPlayerState() === YT.PlayerState.PLAYING) { p.pauseVideo(); p.seekTo(start, true); setPos(0); }
              else setPos(Math.max(0, now - start));
            }, 100);
          },
          onStateChange: (e: any) => {
            if (!live) return;
            setPlaying(e.data === YT.PlayerState.PLAYING);
            if (e.data === YT.PlayerState.ENDED) { p.seekTo(start, true); p.pauseVideo(); setPos(0); }
          },
        },
      });
    });
    return () => { live = false; clearInterval(timer); player.current = null; try { p?.destroy(); } catch {} };
  }, [v, start, endAt, valid]);
  if (!valid) return <pre className="block-error">{`::youtube{v="${v ?? ""}"}`}</pre>;
  const len = Math.max(0, stop - start);
  const toggle = () => { const p = player.current; if (!p) return; playing ? p.pauseVideo() : p.playVideo(); };
  const reset = () => { const p = player.current; if (!p) return; p.seekTo(start, true); p.playVideo(); setPos(0); };
  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = player.current; if (!p || !len) return;
    const r = e.currentTarget.getBoundingClientRect(), frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    p.seekTo(start + frac * len, true); setPos(frac * len);
  };
  const speed = (r: number) => { setRate(r); player.current?.setPlaybackRate(r); };
  const watch = `https://www.youtube.com/watch?v=${v}${start ? `&t=${start}s` : ""}`;
  return (
    <figure className="video">
      <div className="video-frame" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${v}/hqdefault.jpg)` }}><div ref={mount} /></div>
      <div className={`video-bar${ready ? "" : " is-loading"}`}>
        <button type="button" className="video-btn" onClick={toggle} disabled={!ready} aria-label={playing ? "Pause" : "Play the passage"}>
          {playing
            ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z" /></svg>
            : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5v13L14 8z" /></svg>}
        </button>
        <button type="button" className="video-btn video-reset" onClick={reset} disabled={!ready} title={`Restart from ${t ?? "the start"}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5A5.5 5.5 0 1 1 2.5 8" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 0v5L4.5 2.5z" /></svg>
          Reset
        </button>
        <div className="video-progress" onClick={scrub} role="slider" aria-label="Position in the passage" aria-valuemin={0} aria-valuemax={Math.round(len)} aria-valuenow={Math.round(pos)}>
          <div className="video-progress-fill" style={{ width: `${len ? Math.min(100, (pos / len) * 100) : 0}%` }} />
        </div>
        <span className="video-clock">{clock(start + pos)} / {clock(stop || start)}</span>
        <label className="video-rate">Speed
          <select value={rate} onChange={(e) => speed(Number(e.target.value))} disabled={!ready}>
            {rates.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
      </div>
      <figcaption><a href={watch} target="_blank" rel="noreferrer">{title ?? "Watch on YouTube"}{start ? ` · from ${t}` : ""}{end ? ` to ${end}` : ""}</a></figcaption>
    </figure>
  );
}

function Fence({ lang, code, children }: { lang: string; code: string; children: ReactNode }) {
  if (lang === "mermaid") return <Mermaid src={code} />;
  if (lang === "abc") return <Abc src={code} />;
  if (lang === "quiz") {
    try { const spec = YAML.parse(code) as QuizSpec; return <Quiz key={spec.id} spec={spec} />; }
    catch { return <pre className="block-error">{code}</pre>; }
  }
  return <pre><code>{children}</code></pre>;
}

// Defined once at module scope: new component identities on each render would
// remount every quiz and drop focus from its inputs on every keystroke.
const plugins = [remarkGfm, remarkDirective, directives, inlineMarks];
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
    if (kind === "youtube") return <YouTube v={props.v ?? props.id} t={props.t ?? props.start} end={props.end} title={props.title} />;
    return <aside className={`callout callout-${props.type ?? "note"}`} data-kind={kind}>{children}</aside>;
  },
};

export function Markdown({ body }: { body: string }) {
  return <ReactMarkdown remarkPlugins={plugins} components={components}>{body}</ReactMarkdown>;
}
