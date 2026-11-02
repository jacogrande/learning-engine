// Lesson renderer: Markdown + :::directives + typed fences (quiz, mermaid, abc). Fails per block, never per page.
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { directive } from "micromark-extension-directive";
import { directiveFromMarkdown } from "mdast-util-directive";
import { visit } from "unist-util-visit";
import YAML from "yaml";
import { Quiz, type QuizSpec } from "./Quiz";
import { abcSourceProblems, tidyAbc, toSeconds, tuneProblems, youtubeProblems } from "../shared/notation";

// Block directives only: `:::name{…}` (container) and `::name{…}` (leaf). Inline `:name[…]{…}` is
// not registered, so prose like "at 1:43", "a 3:2 ratio" or "1:43[^note]" stays exactly as written.
function blockDirectives(this: any) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ flow: directive().flow });
  (data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
}
// :::name{attr=value} → <div data-directive="name" data-form="containerDirective" attr="value">
function directives() {
  return (tree: any) =>
    visit(tree, (node: any) => {
      if (node.type === "containerDirective" || node.type === "leafDirective") {
        node.data ??= {};
        node.data.hName = "div";
        node.data.hProperties = { "data-directive": node.name, "data-form": node.type, ...node.attributes };
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

// One player at a time: a score or a passage that starts playing pauses every other one on the page.
const MEDIA = "media-play";
const claimPlayback = (id: symbol) => dispatchEvent(new CustomEvent(MEDIA, { detail: id }));
function useExclusive(id: symbol, pause: () => void) {
  const fn = useRef(pause); fn.current = pause;
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail !== id) fn.current(); };
    addEventListener(MEDIA, on); return () => removeEventListener(MEDIA, on);
  }, [id]);
}

// abcjs is about a megabyte, so it is not in the app bundle: the server serves its prebuilt file and
// the first score on a page loads it once.
type Abcjs = typeof import("abcjs");
let abcjsLoad: Promise<Abcjs> | null = null;
function loadAbcjs(): Promise<Abcjs> {
  return abcjsLoad ??= new Promise<Abcjs>((resolve, reject) => {
    const w = window as any;
    if (w.ABCJS) return resolve(w.ABCJS);
    const s = document.createElement("script");
    s.src = "/vendor/abcjs.js"; s.async = true;
    s.onload = () => (w.ABCJS ? resolve(w.ABCJS) : reject(new Error("abcjs did not load")));
    s.onerror = () => reject(new Error("abcjs did not load"));
    document.head.appendChild(s);
  }).catch((e) => { abcjsLoad = null; throw e; });   // a later block tries again
}

// ```abc fences: staff notation written in ABC, engraved by abcjs, with a player when the
// browser can synthesize audio. The soundfont streams from abcjs's default CDN on first play.
// One tune per fence; blank lines inside are dropped (in ABC a blank line ends the tune). Parser
// warnings and bars that do not fill the meter are listed under the score, so a slip shows.
//
// Swing: abcjs parses `%%MIDI swing N` but never plays it, so the tune's own value is read here and
// passed as the synth's `swing` option (50 straight, 66 triplet feel, 75 the most). A selector
// beside the player changes it while listening. abcjs swings only in x/4 and x/8 meters.
const SWINGS: [number, string][] = [[50, "Straight"], [60, "Light"], [66, "Triplet"], [75, "Hard"]];
const swingOf = (src: string) => { const n = Number(/^%%MIDI\s+swing\s+(\d+)/m.exec(src)?.[1]); return n > 50 ? Math.min(75, n) : 50; };
// Without creating one: abcjs's own supportsAudio() makes an AudioContext as a side effect.
const canPlay = () => typeof window !== "undefined" && !!((window as any).AudioContext || (window as any).webkitAudioContext);

function Abc({ src: raw }: { src: string }) {
  const src = tidyAbc(raw);
  const ref = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [swing, setSwing] = useState(() => swingOf(src));
  const [swings, setSwings] = useState(false);   // the meter can swing and the player is up
  const player = useRef<{ controller: any; tune: any } | null>(null);
  const id = useRef(Symbol("abc")).current;
  useExclusive(id, () => player.current?.controller.pause());
  useEffect(() => {
    // Every run starts clean: a block that was broken (or still streaming in) recovers once its source is good.
    setErr(null); setProblems([]); setLoadFailed(false);
    const before = abcSourceProblems(src);
    if (before.length) { setErr(before.join("; ")); return; }
    let live = true, ctl: any = null;
    const initial = swingOf(src);
    setSwing(initial);
    loadAbcjs().then((abc) => {
      if (!live || !ref.current) return;
      try {
        const [tune] = abc.renderAbc(ref.current, src, {
          responsive: "resize", add_classes: true, foregroundColor: "currentColor",
          selectTypes: false,   // no click-to-select: a selected note would look like the one playing
          paddingtop: 0, paddingbottom: 0, paddingleft: 0, paddingright: 0,
        } as any);
        const found = tuneProblems(tune);
        if (!tune?.lines?.length) throw new Error(found.join("; ") || "No music in abc block");
        setProblems(found);
        if (audio.current && canPlay()) {
          const controller = new abc.synth.SynthController() as any;
          ctl = controller;
          // A failed soundfont download leaves abcjs "loading" for good: reset it so Play can retry.
          const play = controller.play;
          controller.play = () => play().catch((e: unknown) => {
            console.warn("abc audio:", e);
            controller.destroy(); controller.isLoading = false; controller.isLoaded = false;
            audio.current?.querySelector(".abcjs-midi-start")?.classList.remove("abcjs-loading");
            if (live) setLoadFailed(true);
          });
          let lit: Element[] = [];
          const clear = () => { lit.forEach((e) => e.classList.remove("is-playing")); lit = []; };
          controller.load(audio.current, {
            onStart: () => { claimPlayback(id); if (live) setLoadFailed(false); },
            onEvent: (ev: any) => { clear(); lit = (ev.elements ?? []).flat(); lit.forEach((e) => e.classList.add("is-playing")); },
            onFinished: clear,
          }, { displayPlay: true, displayProgress: true, displayRestart: true, displayLoop: true, displayWarp: true });
          controller.setTune(tune, false, { swing: initial }).catch((e: unknown) => console.warn("abc audio:", e));
          player.current = { controller, tune };
          setSwings([4, 8].includes(tune.getMeterFraction().den ?? 0));
        }
      } catch (e) { if (live) setErr(String((e as Error)?.message ?? e)); }
    }, (e) => { if (live) setErr(String(e?.message ?? e)); });
    // destroy, not pause: pause does nothing while the first play is still loading its sounds, and
    // that play would then start after the block is gone, with no way to stop it.
    return () => { live = false; try { ctl?.destroy(); } catch {} player.current = null; setSwings(false); };
  }, [src]);
  // A new feel re-primes the synth; playback stops and starts again from the top.
  const changeSwing = (n: number) => {
    setSwing(n);
    const p = player.current; if (!p) return;
    p.controller.pause();
    p.controller.setTune(p.tune, true, { swing: n }).catch((e: unknown) => console.warn("abc audio:", e));
  };
  const own = swingOf(src);
  const options = SWINGS.some(([n]) => n === own) ? SWINGS : [...SWINGS, [own, String(own)] as [number, string]].sort((a, b) => a[0] - b[0]);
  // The figure stays mounted under an error, so the next good source has somewhere to render.
  return (
    <>
      {err && <pre className="block-error" title={err}>{`abc: ${err}\n\n${raw}`}</pre>}
      <figure className="abc" data-noquote hidden={!!err}>
        <div className="abc-score" ref={ref} />
        <div className="abc-player">
          <div className="abc-audio" ref={audio} />
          {swings && (
            <div className="theme abc-swing" role="group" aria-label="Swing">
              {options.map(([n, label]) => <button key={n} type="button" aria-pressed={swing === n} title={n === 50 ? "Even eighths" : `Swing ${n}: the first eighth takes ${n}% of the beat`} onClick={() => changeSwing(n)}>{label}</button>)}
            </div>
          )}
        </div>
        {loadFailed && <p className="block-note" role="alert">The instrument sounds did not load. Check the connection and press play again.</p>}
        {problems.length > 0 && <ul className="block-note abc-problems" aria-label="Problems in this notation">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      </figure>
    </>
  );
}

// ::youtube{v="id" t="1:43" end="1:49" title="…"} → a player for just that passage. YouTube's chrome is
// off; the bar below the frame has play, a reset that jumps back to `t`, a slider bounded by the
// passage, and the speed menu YouTube offers for the video.
//
// Nothing from YouTube loads until the reader presses play or moves the slider: the frame shows
// only the poster image (i.ytimg.com sets no cookies). The IFrame API script itself sets YouTube's
// tracking cookies, so it is fetched on that first press, not when the section opens.
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
let ytApi: Promise<any> | null = null;   // the IFrame API script is loaded once per page
function loadYouTube(): Promise<any> {
  return ytApi ??= new Promise((resolve, reject) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => reject(new Error("YouTube did not answer")), 15000);
    w.onYouTubeIframeAPIReady = () => { clearTimeout(timer); prev?.(); resolve(w.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error("YouTube could not be reached")); };
    document.head.appendChild(s);
  }).catch((e) => { ytApi = null; throw e; });   // the next press tries again
}
// YouTube's onError codes, as the reader should hear them.
const YT_ERRORS: Record<number, string> = {
  2: "The video id is not valid.", 5: "This browser cannot play the video.",
  100: "The video is gone or private.", 101: "The owner does not allow this video to play outside YouTube.", 150: "The owner does not allow this video to play outside YouTube.",
};

type Pending = { play: boolean; to: number } | null;   // what the first press asked for, done once the player is ready

function YouTube({ v, t, end, title }: { v?: string; t?: string; end?: string; title?: string }) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const pending = useRef<Pending>(null);
  const hold = useRef(false);   // a seek before the first play starts playback: stop it again, muted
  const id = useRef(Symbol("yt")).current;
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);                 // seconds into the passage
  const [duration, setDuration] = useState(0);       // the video's, for a passage with no `end`
  const [rates, setRates] = useState<number[]>([1]);
  const [rate, setRate] = useState(1);
  const problems = youtubeProblems({ v, t, end });
  const start = toSeconds(t) ?? 0, endAt = toSeconds(end) ?? 0;
  const stop = endAt || duration, len = Math.max(0, stop - start);
  useExclusive(id, () => { if (playing) player.current?.pauseVideo(); });
  useEffect(() => () => { const p = player.current; player.current = null; try { p?.destroy(); } catch {} }, []);

  const seek = (p: any, to: number, play: boolean) => {
    // Only a video that has not played yet (unstarted or cued) starts on seekTo; a paused one stays
    // paused. So only then is the seek muted and stopped again, with a timeout in case it never starts.
    const fresh = [-1, 5].includes(p.getPlayerState?.());
    if (!play && fresh) {
      hold.current = true; p.mute();
      setTimeout(() => { if (hold.current) { hold.current = false; p.unMute(); } }, 2000);
    }
    p.seekTo(to, true);
    if (play) p.playVideo();
    setPos(Math.max(0, to - start));
  };
  // The first press: load the API, build the player, then do what was asked.
  const activate = (want: Pending) => {
    pending.current = want;
    if (phase === "loading") return;
    setPhase("loading"); setError(null);
    loadYouTube().then((YT) => {
      if (!mount.current) return;
      const el = document.createElement("div");
      mount.current.replaceChildren(el);
      const p = new YT.Player(el, {
        videoId: v, host: "https://www.youtube-nocookie.com",
        // `start` must be whole seconds or YouTube ignores it; the exact start is sought once ready.
        // No `end`: the passage end is kept below, and YouTube's own would flash its end screen.
        // `autoplay` carries the first press into the new iframe: a playVideo() call once it is
        // ready comes too late for the browser to count it as the reader's.
        playerVars: { start: Math.floor(start), autoplay: want?.play ? 1 : 0, controls: 0, rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3, playsinline: 1, origin: location.origin },
        events: {
          onReady: () => {
            if (!mount.current) { try { p.destroy(); } catch {} return; }   // the section closed while it loaded
            player.current = p;
            const list: number[] = p.getAvailablePlaybackRates?.() ?? [1];
            setRates(list.length ? list : [1]);
            setDuration(p.getDuration?.() || 0);
            if (title) try { p.getIframe().title = title; } catch {}
            setPhase("ready");
            const w = pending.current; pending.current = null;
            if (w && (w.to !== Math.floor(start) || !w.play)) seek(p, w.to, w.play);   // autoplay already started it at the whole second
            const timer = setInterval(() => {
              if (player.current !== p) return clearInterval(timer);
              if (!endAt) { const d = p.getDuration?.() || 0; setDuration((x) => (x === d ? x : d)); }
              const now = p.getCurrentTime?.() ?? start;
              // Stop a hair before the end, so the next frame never shows.
              if (endAt && now >= endAt - 0.05 && p.getPlayerState() === YT.PlayerState.PLAYING) { p.pauseVideo(); p.seekTo(start, true); setPos(0); }
              else setPos(Math.max(0, now - start));
            }, 50);
          },
          onStateChange: (e: any) => {
            const S = YT.PlayerState;
            if (e.data === S.PLAYING && hold.current) { hold.current = false; p.pauseVideo(); p.unMute(); return; }
            // Buffering counts as playing, so the button can still pause it.
            const on = e.data === S.PLAYING || e.data === S.BUFFERING;
            setPlaying(on);
            if (e.data === S.PLAYING) claimPlayback(id);
            if (e.data === S.ENDED) { p.seekTo(start, true); p.pauseVideo(); setPos(0); }
          },
          onError: (e: any) => { setPhase("error"); setError(YT_ERRORS[e.data] ?? "The video cannot play here."); },
        },
      });
    }, (e) => { setPhase("error"); setError(`${e.message}. Check the connection and try again.`); });
  };

  if (problems.length) return <pre className="block-error">{`::youtube: ${problems.join("; ")}\n::youtube{v="${v ?? ""}" t="${t ?? ""}" end="${end ?? ""}"}`}</pre>;
  const p = player.current, ready = phase === "ready" && !!p;
  const toggle = () => (ready ? (playing ? p.pauseVideo() : seek(p, start + (pos >= len - 0.1 ? 0 : pos), true)) : activate({ play: true, to: start }));
  const reset = () => (ready ? seek(p, start, true) : activate({ play: true, to: start }));
  const scrub = (x: number) => (ready ? seek(p, start + x, false) : activate({ play: false, to: start + x }));
  const speed = (r: number) => { setRate(r); p?.setPlaybackRate(r); };
  const watch = `https://www.youtube.com/watch?v=${v}${start ? `&t=${Math.floor(start)}s` : ""}`;
  return (
    <figure className="video" data-noquote>
      <div className="video-frame" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${v}/hqdefault.jpg)` }}>
        <div ref={mount} />
        {phase !== "ready" && phase !== "error" && (
          <button type="button" className="video-cover" onClick={toggle} aria-label={`Play the passage${title ? `: ${title}` : ""}`}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v12l10-6z" /></svg>
          </button>
        )}
      </div>
      {phase === "error" ? (
        <p className="block-error video-error" role="alert">
          {error} <a href={watch} target="_blank" rel="noreferrer">Watch on YouTube</a>
          {error?.includes("try again") && <> · <button type="button" className="link" onClick={() => activate(null)}>Try again</button></>}
        </p>
      ) : (
        <div className={`video-bar${phase === "loading" ? " is-loading" : ""}`} aria-busy={phase === "loading"}>
          <button type="button" className="video-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play the passage"}>
            {playing
              ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z" /></svg>
              : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5v13L14 8z" /></svg>}
          </button>
          <button type="button" className="video-btn video-reset" onClick={reset} title={`Restart from ${t ?? "the start"}`}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5A5.5 5.5 0 1 1 2.5 8" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 0v5L4.5 2.5z" /></svg>
            Reset
          </button>
          <input type="range" className="video-progress" aria-label="Position in the passage" min={0} max={Math.max(len, 0.5)} step={0.5}
            value={Math.min(pos, len)} disabled={!len} aria-valuetext={`${clock(start + pos)} of ${clock(stop)}`}
            style={{ ["--fill" as any]: `${len ? Math.min(100, (pos / len) * 100) : 0}%` }} onChange={(e) => scrub(Number(e.target.value))} />
          <span className="video-clock">{clock(start + pos)} / {stop ? clock(stop) : "–"}</span>
          <label className="video-rate">Speed
            <select value={rate} onChange={(e) => speed(Number(e.target.value))} disabled={!ready}>
              {rates.map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
          </label>
        </div>
      )}
      <figcaption><a href={watch} target="_blank" rel="noreferrer">{title ?? "Watch on YouTube"}{t ? ` · from ${t}` : ""}{end ? ` to ${end}` : ""}</a></figcaption>
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
const plugins = [remarkGfm, blockDirectives, directives, inlineMarks];
const components = {
  pre: ({ children }: any) => <>{children}</>,   // fences are handled in `code`
  code: ({ className, children, ...rest }: any) => {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    const code = String(children ?? "").replace(/\n$/, "");   // an empty fence has no children at all
    const inline = !className && !code.includes("\n");
    return inline ? <code {...rest}>{children}</code> : <Fence lang={lang ?? ""} code={code}>{children}</Fence>;
  },
  div: ({ node, children, ...props }: any) => {
    const kind = props["data-directive"];
    if (!kind) return <div {...props}>{children}</div>;
    if (kind === "youtube") {
      // Keyed by the passage, so an edit to it while open builds a fresh player with fresh state.
      const yt = <YouTube key={`${props.v ?? props.id}|${props.t ?? props.start}|${props.end}`} v={props.v ?? props.id} t={props.t ?? props.start} end={props.end} title={props.title} />;
      // `:::youtube` (the container form) by mistake holds the rest of the section: keep it visible.
      return props["data-form"] === "containerDirective" ? <>{yt}{children}</> : yt;
    }
    return <aside className={`callout callout-${props.type ?? "note"}`} data-kind={kind}>{children}</aside>;
  },
};

export function Markdown({ body }: { body: string }) {
  return <ReactMarkdown remarkPlugins={plugins} components={components}>{body}</ReactMarkdown>;
}
