// Vocabulary: capture from anywhere (Alt+V, or Vocab in a lesson's selection menu), and the list.
import { useCallback, useEffect, useRef, useState } from "react";
import { del, post, put, useEvent, useLive } from "./api";
import { Markdown } from "./Markdown";
import { sentenceAround } from "./selection";
import { Link, Shell } from "./App";

export type Example = { sentence: string; form: string };
export type Probe = { question: string; answer: string };
export type Entry = { headword: string; pos: string; explanation: string; examples: Example[]; tests?: Example[]; forms?: string[]; confusable: { word: string; difference: string } | null; parts: string | null; register: string | null; probes?: Probe[] };
export type Context = { text: string; form: string; course: string | null; doc: string | null; title: string | null; at: string };
export type Word = {
  id: string; word: string; contexts: Context[]; courseTerm: string | null; entry: Entry | null; status: "pending" | "ready" | "failed"; writing: boolean; stage: number;
  trainedAt: string | null; createdAt: string; trains: number;
  card: { due: string; state: string; streak: number; suspended: boolean; reviews: number } | null;
};
export type Counts = { total: number; pending: number; failed: number; new: number; climbing: number; through: number; trainedToday: number; trainable: number; reviewFirst: number; held: number };
export type Format = "meet" | "pick" | "recall" | "explain" | "use";
// One Train task, as /api/vocab/train and /api/vocab/:id/task send it.
export type Task = {
  word: string; format: Format; stage: number; headword: string; entry: Entry; contexts: Context[]; courseTerm: string | null;
  sentence: string; form: string; anchor: Example; prompt: string; hint?: string; options?: string[]; answer?: number; probe?: Probe;
};
export const VOCAB = "_vocab";   // the pseudo-course vocab cards live under
export const RUNGS = ["Meet", "Pick", "Recall", "Explain", "Use"];
export const DONE = RUNGS.length;
export const DIFFICULTY = ["Effortful", "Some effort", "Instant"];
// The sentence with its word in bold, matched as a whole word ("art" is not inside "start").
export const bold = (sentence: string, form: string) => {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").exec(sentence);
  return m ? `${sentence.slice(0, m.index)}**${form}**${sentence.slice(m.index + form.length)}` : sentence.replace(form, `**${form}**`);
};

// A message in the corner. Toasts (JobBar.tsx) shows it.
export const toast = (text: string, to?: string | null, bad = false) => dispatchEvent(new CustomEvent("toast", { detail: { text, to, bad } }));
// A request that failed: a status from the server, or nothing at all from a dropped connection.
export const failed = (what: string) => (e: unknown) => toast(typeof e === "number" ? `${what} failed (${e}).` : `${what} failed: the server cannot be reached.`, null, true);

// --- capture ----------------------------------------------------------------------
export type Capture = { word: string; context?: string; course?: string | null; doc?: string | null; title?: string | null; courseTerm?: boolean };

// Captures made while the server cannot be reached wait in this browser and are sent when it can.
const OUTBOX = "vocab-outbox";
const outbox = (): Capture[] => { try { return JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"); } catch { return []; } };
const setOutbox = (xs: Capture[]) => { try { xs.length ? localStorage.setItem(OUTBOX, JSON.stringify(xs)) : localStorage.removeItem(OUTBOX); } catch {} };
let flushing = false;
async function flushOutbox() {
  if (flushing || !outbox().length) return;
  flushing = true;
  try {
    for (const c of outbox()) {
      let ok = true;
      try { await post("/api/vocab", c); } catch (e) { if (typeof e !== "number") break; ok = false; }   // still offline: try later; rejected: drop it
      setOutbox(outbox().filter((x) => !(x.word === c.word && x.context === c.context)));
      toast(ok ? `Added “${c.word}”, kept while offline.` : `“${c.word}”, kept while offline, was refused by the server.`, ok ? "/vocab" : null, !ok);
    }
  } finally { flushing = false; }
}

export async function capture(c: Capture) {
  try {
    const r = await post<{ word: Word; existed: boolean }>("/api/vocab", c);
    const name = r.word.entry?.headword ?? r.word.word;
    toast(r.existed ? `“${name}” is already in your list${c.context ? "; this sentence was added to it" : ""}.` : `Added “${name}”. Its entry is being written.`, `/vocab#w-${r.word.id}`);
    return r.word;
  } catch (e) {
    if (typeof e === "number") { toast(e === 400 ? "That did not save. A word or short phrase, please." : `That did not save (${e}).`, null, true); return null; }
    setOutbox([...outbox(), c]);
    toast(`The server cannot be reached. “${c.word}” is kept in this browser and added when it is back.`);
    return true;
  }
}

// Where the learner is, for the capture's source.
function here(): { course: string | null; doc: string | null; title: string | null } {
  const m = /^\/c\/([^/]+)(?:\/m\/([^/]+)\/([^?#]+))?/.exec(location.pathname);
  const title = m ? document.querySelector("article h1, .page h1")?.textContent ?? null : null;   // a page title is a source only in a course
  return { course: m?.[1] ?? null, doc: m?.[2] && m[3] && m[3].endsWith(".md") ? `modules/${m[2]}/${m[3]}` : null, title };
}

// Alt+V anywhere: add a word. A selection, if there is one, fills the word and its sentence. Also
// sends captures kept while offline, on load and whenever the connection comes back.
export function VocabCapture() {
  const [open, setOpen] = useState<null | { word: string; context: string }>(null);
  useEffect(() => {
    const show = () => { const s = sentenceAround(); setOpen({ word: s?.word ?? "", context: s?.sentence ?? "" }); };
    const onKey = (e: KeyboardEvent) => { if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyV") { e.preventDefault(); show(); } };
    addEventListener("keydown", onKey); addEventListener("vocab-add", show); addEventListener("online", flushOutbox);
    flushOutbox();
    return () => { removeEventListener("keydown", onKey); removeEventListener("vocab-add", show); removeEventListener("online", flushOutbox); };
  }, []);
  useEvent("content", useCallback((ev: any) => { if (ev.reconnect) flushOutbox(); }, []));
  if (!open) return null;
  return <AddForm initial={open} onClose={() => setOpen(null)} />;
}

// A native modal dialog: it traps focus, closes on Escape and gives focus back to where it was.
function AddForm({ initial, onClose }: { initial: { word: string; context: string }; onClose: () => void }) {
  const [word, setWord] = useState(initial.word);
  const [context, setContext] = useState(initial.context);
  const [busy, setBusy] = useState(false);
  const src = useRef(here()).current;
  const [term, setTerm] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null, d = ref.current!;
    d.showModal();
    return () => { if (d.open) d.close(); back?.focus?.(); };
  }, []);
  const dirty = word !== initial.word || context !== initial.context;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim() || busy) return;
    setBusy(true);
    const ok = await capture({ word, context, ...src, courseTerm: term });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <dialog ref={ref} className="modal vocab-add" aria-labelledby="vocab-add-title" onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !dirty) onClose(); }}>
      <form onSubmit={submit}>
        <h2 id="vocab-add-title">Add a word</h2>
        <label>Word or phrase<input className="field" autoFocus value={word} onChange={(e) => setWord(e.target.value)} placeholder="e.g. obdurate" /></label>
        <label>Where you met it <span className="muted">(optional; the sentence becomes its first example)</span><textarea className="field" rows={3} value={context} onChange={(e) => setContext(e.target.value)} /></label>
        {src.course && <label className="check"><input type="checkbox" checked={term} onChange={(e) => setTerm(e.target.checked)} /> A term of this course <span className="muted">(reviewed with the course's own cards)</span></label>}
        <div className="actions"><button type="submit" className="primary" disabled={!word.trim() || busy}>{busy ? "Adding…" : "Add"}</button><button type="button" onClick={onClose}>Cancel</button><span className="muted">Alt+V from any page</span></div>
      </form>
    </dialog>
  );
}

// Key handlers on window must leave keys typed into the add-word dialog alone.
export const inDialog = (e: Event) => !!(e.target as Element | null)?.closest?.("dialog");

// --- /vocab -----------------------------------------------------------------------
const rel = (iso: string) => {
  const d = Math.round((+new Date(iso) - Date.now()) / 864e5);
  return d <= 0 ? "due now" : d === 1 ? "due tomorrow" : `due in ${d} days`;
};
type Filter = "all" | "new" | "climbing" | "through" | "problems";
const hashId = () => /^#w-(.+)$/.exec(location.hash)?.[1] ?? null;
// Pending with no job behind it: the job was lost with the last server process.
const stuck = (w: Word) => w.status === "pending" && !w.writing;

export function VocabPage() {
  const { data, error, reload } = useLive<{ words: Word[]; counts: Counts }>("/api/vocab", ["vocab", "card", "job"]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(hashId);
  // A link to /vocab#w-… while already here (a toast's Open) changes only the hash.
  useEffect(() => {
    const on = () => { const h = hashId(); if (h) setOpenId(h); };
    addEventListener("popstate", on); addEventListener("hashchange", on);
    return () => { removeEventListener("popstate", on); removeEventListener("hashchange", on); };
  }, []);
  useEffect(() => { if (openId) requestAnimationFrame(() => document.getElementById(`w-${openId}`)?.scrollIntoView({ block: "center" })); }, [!!data, openId]);
  const crumbs = [{ label: "Courses", to: "/" }, { label: "Vocabulary" }];
  if (!data) return (
    <Shell crumbs={crumbs} className="page"><h1>Vocabulary</h1>
      {error && <p className="muted empty">The word list did not load{typeof error === "number" ? ` (${error})` : ""}. <button className="link" onClick={reload}>Try again</button></p>}
    </Shell>
  );
  const c = data.counts, needle = q.trim().toLowerCase();
  const shown = data.words.filter((w) =>
    (filter === "all" || (filter === "new" && w.status === "ready" && w.stage === 0) || (filter === "climbing" && w.stage > 0 && w.stage < DONE) || (filter === "through" && w.stage >= DONE) || (filter === "problems" && (w.status === "failed" || stuck(w) || w.card?.suspended)))
    && (!needle || [w.word, w.entry?.headword, w.entry?.explanation, ...w.contexts.map((x) => x.text)].some((t) => t?.toLowerCase().includes(needle))));
  return (
    <Shell crumbs={crumbs} className="page vocab-page">
      <div className="page-head"><h1>Vocabulary</h1>
        <div className="actions"><button onClick={() => dispatchEvent(new Event("vocab-add"))}>Add word</button><Link to="/vocab/train" className="btn primary">Train{c.trainable ? ` · ${c.trainable}` : ""}</Link></div>
      </div>
      <p className="meta">{c.total} words · {c.new} new · {c.climbing} climbing · {c.through} through the ladder{c.pending ? ` · ${c.pending} being written` : ""}{c.failed ? ` · ${c.failed} failed` : ""}{c.trainedToday ? ` · ${c.trainedToday} trained today` : ""}</p>
      {c.total === 0 ? (
        <p className="muted empty">No words yet. Select a word in a lesson and choose Vocab (or press V), or press Alt+V on any page.</p>
      ) : <>
        <div className="vocab-tools">
          <input className="field" type="search" aria-label="Search words" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words, meanings, sentences" />
          <div className="theme" role="group" aria-label="Filter">{(["all", "new", "climbing", "through", "problems"] as Filter[]).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
        </div>
        <ul className="vocab-list">
          {shown.map((w) => <WordRow key={w.id} w={w} open={openId === w.id} toggle={() => setOpenId(openId === w.id ? null : w.id)} reload={reload} />)}
        </ul>
        {!shown.length && <p className="muted">Nothing matches.</p>}
      </>}
    </Shell>
  );
}

export function Ladder({ stage }: { stage: number }) {
  const label = stage >= DONE ? "Through the ladder" : `Rung ${stage} of ${DONE}; next: ${RUNGS[stage]}`;
  return <span className="ladder" role="img" aria-label={label} title={label}>{RUNGS.map((r, i) => <i key={r} className={i < stage ? "on" : ""} />)}</span>;
}

function WordRow({ w, open, toggle, reload }: { w: Word; open: boolean; toggle: () => void; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const e = w.entry;
  const name = e?.headword ?? w.word;
  const status = stuck(w) ? "entry interrupted" : w.status === "pending" ? "writing entry…" : w.status === "failed" ? "entry failed" : w.card?.suspended ? "suspended" : w.card ? (w.card.state === "learned" ? "learned" : rel(w.card.due)) : w.stage === 0 ? "meet it in Train" : "";
  const regenerate = () => post(`/api/vocab/${w.id}/regenerate`).then(reload, failed("Rewriting the entry"));
  return (
    <li id={`w-${w.id}`} className={`vocab-row ${open ? "is-open" : ""}`}>
      <button className="vocab-head" onClick={toggle} aria-expanded={open} aria-controls={`wb-${w.id}`}>
        <span className="vocab-word">{name}</span>
        {e?.pos && <span className="muted">{e.pos}</span>}
        <span className="vocab-def">{e?.explanation ?? ""}</span>
        <Ladder stage={w.stage} />
        <span className="muted vocab-status">{status}</span>
      </button>
      {open && (
        <div className="vocab-body" id={`wb-${w.id}`}>
          {(w.status === "failed" || stuck(w)) && <p className="actions"><span className="muted">{w.status === "failed" ? "The entry could not be written." : "Writing the entry was cut off when the server stopped."}</span><button onClick={regenerate}>Try again</button></p>}
          {e && !editing && <WordEntry w={w} />}
          {e && editing && <EditEntry w={w} done={() => { setEditing(false); reload(); }} />}
          <div className="actions">
            {e && !editing && <button onClick={() => setEditing(true)}>Edit</button>}
            {e && w.status !== "pending" && <button onClick={() => { if (confirm("Rewrite the explanation and examples? Your edits will be replaced.")) regenerate(); }}>Rewrite entry</button>}
            {w.contexts.some((c) => c.course) && <button className="link" onClick={() => put(`/api/vocab/${w.id}`, { courseTerm: w.courseTerm ? null : w.contexts.find((c) => c.course)!.course }).then(reload, failed("Changing the course-term mark"))}>{w.courseTerm ? "Not a course term" : "Mark as a course term"}</button>}
            <span className="spacer" />
            <button className="link" onClick={() => { if (confirm(`Delete “${name}” and its review history?`)) del(`/api/vocab/${w.id}`).then(reload, failed("Deleting")); }}>Delete</button>
          </div>
        </div>
      )}
    </li>
  );
}

// The full entry, as far as the word has come. Before Train has met it, only the explanation and
// where it was met: the examples are for after the first meeting. The confusable waits for the
// Explain rung, so a new word is not learned alongside its near-neighbour.
export function WordEntry({ w }: { w: Pick<Word, "entry" | "contexts" | "courseTerm" | "stage"> }) {
  const e = w.entry!;
  return (
    <div className="word-entry">
      <p className="lede">{e.explanation}</p>
      <p className="meta">{[e.pos, e.register, w.courseTerm && "course term"].filter(Boolean).join(" · ")}</p>
      {w.stage === 0 ? <p className="muted">Examples appear once you have met the word in <Link to="/vocab/train">Train</Link>.</p> : <>
        <h4>In use</h4>
        <ul>{e.examples.map((x, i) => <li key={i}><Markdown body={bold(x.sentence, x.form)} /></li>)}</ul>
      </>}
      {e.confusable && w.stage >= 3 && <><h4>Not to be confused with {e.confusable.word}</h4><p>{e.confusable.difference}</p></>}
      {e.parts && <><h4>Parts</h4><p>{e.parts}</p></>}
      {w.contexts.length > 0 && <>
        <h4>Where you met it</h4>
        <ul className="contexts">{w.contexts.map((c, i) => (
          <li key={i}><Markdown body={`> ${bold(c.text, c.form)}`} />{c.doc && c.course ? <Link to={`/c/${c.course}/m/${c.doc.split("/").slice(1).join("/")}`} className="muted">{c.title ?? "source"}</Link> : c.title ? <span className="muted">{c.title}</span> : null}</li>
        ))}</ul>
      </>}
    </div>
  );
}

function EditEntry({ w, done }: { w: Word; done: () => void }) {
  const e = w.entry!;
  const [explanation, setExplanation] = useState(e.explanation);
  const [examples, setExamples] = useState(e.examples.map((x) => x.sentence).join("\n"));
  const [conf, setConf] = useState(e.confusable?.word ?? "");
  const [diff, setDiff] = useState(e.confusable?.difference ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async () => {
    // Each example line must still contain a form of the word to be blanked out; keep the form the
    // old line used when it is still there, else any listed form.
    const lines = examples.split("\n").map((l) => l.trim()).filter(Boolean);
    const forms = [...new Set([...e.examples.map((x) => x.form), ...(e.forms ?? []), e.headword])];
    const exs = lines.map((s) => ({ sentence: s, form: forms.find((f) => s.includes(f)) ?? "" })).filter((x) => x.form);
    if (exs.length < lines.length && !confirm(`${lines.length - exs.length} example(s) do not contain the word and will be dropped. Save anyway?`)) return;
    if (exs.length < 2) return setError("Keep at least two examples that contain the word.");
    try {
      await put(`/api/vocab/${w.id}`, { entry: { explanation, examples: exs, confusable: conf.trim() && diff.trim() ? { word: conf.trim(), difference: diff.trim() } : null } });
      done();
    } catch (x) { setError(typeof x === "number" ? `Not saved (${x}). An entry needs an explanation and two examples.` : "Not saved: the server cannot be reached. Your edits are still here."); }
  }, [explanation, examples, conf, diff]);
  return (
    <div className="new-course vocab-edit">
      <label>Explanation<textarea rows={2} value={explanation} onChange={(x) => setExplanation(x.target.value)} /></label>
      <label>Examples <span className="muted">(one per line; each must contain the word)</span><textarea rows={5} value={examples} onChange={(x) => setExamples(x.target.value)} /></label>
      <label>Confused with<input value={conf} onChange={(x) => setConf(x.target.value)} /></label>
      <label>The difference<textarea rows={2} value={diff} onChange={(x) => setDiff(x.target.value)} /></label>
      <div className="actions"><button className="primary" onClick={save}>Save</button><button onClick={done}>Cancel</button>{error && <span className="muted" role="alert">{error}</span>}</div>
    </div>
  );
}
