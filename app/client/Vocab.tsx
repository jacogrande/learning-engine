// Vocabulary: capture from anywhere (Alt+V, or Vocab in a lesson's selection menu), and the list.
import { useCallback, useEffect, useRef, useState } from "react";
import { del, post, put, useLive } from "./api";
import { Markdown } from "./Markdown";
import { sentenceAround } from "./selection";
import { Link, Shell } from "./App";

export type Example = { sentence: string; form: string };
export type Entry = { headword: string; pos: string; explanation: string; examples: Example[]; confusable: { word: string; difference: string } | null; parts: string | null; register: string | null };
export type Context = { text: string; form: string; course: string | null; doc: string | null; title: string | null; at: string };
export type Word = {
  id: string; word: string; contexts: Context[]; courseTerm: string | null; entry: Entry | null; status: "pending" | "ready" | "failed"; stage: number;
  trainedAt: string | null; createdAt: string; trains: number;
  card: { due: string; state: string; streak: number; suspended: boolean; reviews: number } | null;
};
export type Counts = { total: number; pending: number; failed: number; new: number; climbing: number; through: number; trainedToday: number; trainable: number };
export const RUNGS = ["Meet", "Pick", "Recall", "Explain", "Use"];
export const DIFFICULTY = ["Effortful", "Some effort", "Instant"];

// A message in the corner. Toasts (JobBar.tsx) shows it.
export const toast = (text: string, to?: string | null, bad = false) => dispatchEvent(new CustomEvent("toast", { detail: { text, to, bad } }));

export type Capture = { word: string; context?: string; course?: string | null; doc?: string | null; title?: string | null; courseTerm?: boolean };
export async function capture(c: Capture) {
  try {
    const r = await post<{ word: Word; existed: boolean }>("/api/vocab", c);
    const name = r.word.entry?.headword ?? r.word.word;
    toast(r.existed ? `“${name}” is already in your list${c.context ? "; this sentence was added to it" : ""}.` : `Added “${name}”. Its entry is being written.`, `/vocab#w-${r.word.id}`);
    return r.word;
  } catch { toast("That did not save. A word or short phrase, please.", null, true); return null; }
}

// Where the learner is, for the capture's source.
function here(): { course: string | null; doc: string | null; title: string | null } {
  const m = /^\/c\/([^/]+)(?:\/m\/([^/]+)\/([^?#]+))?/.exec(location.pathname);
  const title = document.querySelector("article h1, .page h1")?.textContent ?? null;
  return { course: m?.[1] ?? null, doc: m?.[2] && m[3] && m[3].endsWith(".md") ? `modules/${m[2]}/${m[3]}` : null, title };
}

// Alt+V anywhere: add a word. A selection, if there is one, fills the word and its sentence.
export function VocabCapture() {
  const [open, setOpen] = useState<null | { word: string; context: string }>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyV") {
        e.preventDefault();
        const s = sentenceAround();
        setOpen({ word: s?.word ?? "", context: s?.sentence ?? "" });
      }
    };
    const onOpen = () => { const s = sentenceAround(); setOpen({ word: s?.word ?? "", context: s?.sentence ?? "" }); };
    addEventListener("keydown", onKey); addEventListener("vocab-add", onOpen);
    return () => { removeEventListener("keydown", onKey); removeEventListener("vocab-add", onOpen); };
  }, []);
  if (!open) return null;
  return <AddForm initial={open} onClose={() => setOpen(null)} />;
}

function AddForm({ initial, onClose }: { initial: { word: string; context: string }; onClose: () => void }) {
  const [word, setWord] = useState(initial.word);
  const [context, setContext] = useState(initial.context);
  const src = useRef(here()).current;
  const [term, setTerm] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!word.trim()) return; if (await capture({ word, context, ...src, courseTerm: term })) onClose(); };
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal vocab-add" onSubmit={submit} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <h2>Add a word</h2>
        <label>Word or phrase<input className="field" autoFocus value={word} onChange={(e) => setWord(e.target.value)} placeholder="e.g. obdurate" /></label>
        <label>Where you met it <span className="muted">(optional; the sentence becomes its first example)</span><textarea className="field" rows={3} value={context} onChange={(e) => setContext(e.target.value)} /></label>
        {src.course && <label className="check"><input type="checkbox" checked={term} onChange={(e) => setTerm(e.target.checked)} /> A term of this course <span className="muted">(reviewed with the course's own cards)</span></label>}
        <div className="actions"><button type="submit" className="primary" disabled={!word.trim()}>Add</button><button type="button" onClick={onClose}>Cancel</button><span className="muted">Alt+V from any page</span></div>
      </form>
    </div>
  );
}

// --- /vocab -----------------------------------------------------------------------
const rel = (iso: string) => {
  const d = Math.round((+new Date(iso) - Date.now()) / 864e5);
  return d <= 0 ? "due now" : d === 1 ? "due tomorrow" : `due in ${d} days`;
};
type Filter = "all" | "new" | "climbing" | "through" | "problems";

export function VocabPage() {
  const { data, reload } = useLive<{ words: Word[]; counts: Counts }>("/api/vocab", ["vocab", "card"]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(() => /^#w-(.+)$/.exec(location.hash)?.[1] ?? null);
  useEffect(() => { if (openId) requestAnimationFrame(() => document.getElementById(`w-${openId}`)?.scrollIntoView({ block: "center" })); }, [data && openId]);
  const crumbs = [{ label: "Courses", to: "/" }, { label: "Vocabulary" }];
  if (!data) return <Shell crumbs={crumbs} className="page"><h1>Vocabulary</h1></Shell>;
  const c = data.counts, needle = q.trim().toLowerCase();
  const shown = data.words.filter((w) =>
    (filter === "all" || (filter === "new" && w.status === "ready" && w.stage === 0) || (filter === "climbing" && w.stage > 0 && w.stage < 5) || (filter === "through" && w.stage >= 5) || (filter === "problems" && (w.status === "failed" || w.card?.suspended)))
    && (!needle || [w.word, w.entry?.headword, w.entry?.explanation, ...w.contexts.map((x) => x.text)].some((t) => t?.toLowerCase().includes(needle))));
  const trainable = c.trainable;
  return (
    <Shell crumbs={crumbs} className="page vocab-page">
      <div className="page-head"><h1>Vocabulary</h1>
        <div className="actions"><button onClick={() => dispatchEvent(new Event("vocab-add"))}>Add word</button><Link to="/vocab/train" className="btn primary">Train{trainable ? ` · ${trainable}` : ""}</Link></div>
      </div>
      <p className="meta">{c.total} words · {c.new} new · {c.climbing} climbing · {c.through} through the ladder{c.pending ? ` · ${c.pending} being written` : ""}{c.trainedToday ? ` · ${c.trainedToday} trained today` : ""}</p>
      {c.total === 0 ? (
        <p className="muted empty">No words yet. Select a word in a lesson and choose Vocab (or press V), or press Alt+V on any page.</p>
      ) : <>
        <div className="vocab-tools">
          <input className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words, meanings, sentences" />
          <div className="theme">{(["all", "new", "climbing", "through", "problems"] as Filter[]).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
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
  return <span className="ladder" title={stage >= 5 ? "Through the ladder" : `Next: ${RUNGS[stage]}`}>{RUNGS.map((r, i) => <i key={r} className={i < stage ? "on" : ""} />)}</span>;
}

function WordRow({ w, open, toggle, reload }: { w: Word; open: boolean; toggle: () => void; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const e = w.entry;
  const status = w.status === "pending" ? "writing entry…" : w.status === "failed" ? "entry failed" : w.card?.suspended ? "suspended" : w.card ? (w.card.state === "learned" ? "learned" : rel(w.card.due)) : "";
  return (
    <li id={`w-${w.id}`} className={`vocab-row ${open ? "is-open" : ""}`}>
      <button className="vocab-head" onClick={toggle}>
        <span className="vocab-word">{e?.headword ?? w.word}</span>
        {e?.pos && <span className="muted">{e.pos}</span>}
        <span className="vocab-def">{e?.explanation ?? ""}</span>
        <Ladder stage={w.stage} />
        <span className="muted vocab-status">{status}</span>
      </button>
      {open && (
        <div className="vocab-body">
          {w.status === "failed" && <p className="actions"><span className="muted">The entry could not be written.</span><button onClick={() => post(`/api/vocab/${w.id}/regenerate`).then(reload)}>Try again</button></p>}
          {e && !editing && <WordEntry w={w} />}
          {e && editing && <EditEntry w={w} done={() => { setEditing(false); reload(); }} />}
          <div className="actions">
            {e && !editing && <button onClick={() => setEditing(true)}>Edit</button>}
            {w.status !== "pending" && <button onClick={() => { if (confirm("Rewrite the explanation and examples? Your edits will be replaced.")) post(`/api/vocab/${w.id}/regenerate`).then(reload); }}>Rewrite entry</button>}
            {w.contexts.some((c) => c.course) && <button className="link" onClick={() => put(`/api/vocab/${w.id}`, { courseTerm: w.courseTerm ? null : w.contexts.find((c) => c.course)!.course }).then(reload)}>{w.courseTerm ? "Not a course term" : "Mark as a course term"}</button>}
            <span className="spacer" />
            <button className="link" onClick={() => { if (confirm(`Delete “${e?.headword ?? w.word}” and its review history?`)) del(`/api/vocab/${w.id}`).then(reload); }}>Delete</button>
          </div>
        </div>
      )}
    </li>
  );
}

// The full entry: also the Meet card in Train.
export function WordEntry({ w }: { w: Pick<Word, "entry" | "contexts" | "courseTerm"> }) {
  const e = w.entry!;
  const mark = (s: string, form: string) => s.replace(form, `**${form}**`);
  return (
    <div className="word-entry">
      <p className="lede">{e.explanation}</p>
      <p className="meta">{[e.pos, e.register, w.courseTerm && "course term"].filter(Boolean).join(" · ")}</p>
      <h4>In use</h4>
      <ul>{e.examples.map((x, i) => <li key={i}><Markdown body={mark(x.sentence, x.form)} /></li>)}</ul>
      {e.confusable && <><h4>Not to be confused with {e.confusable.word}</h4><p>{e.confusable.difference}</p></>}
      {e.parts && <><h4>Parts</h4><p>{e.parts}</p></>}
      {w.contexts.length > 0 && <>
        <h4>Where you met it</h4>
        <ul className="contexts">{w.contexts.map((c, i) => (
          <li key={i}><Markdown body={`> ${mark(c.text, c.form)}`} />{c.doc && c.course ? <Link to={`/c/${c.course}/m/${c.doc.split("/").slice(1).join("/")}`} className="muted">{c.title ?? "source"}</Link> : c.title ? <span className="muted">{c.title}</span> : null}</li>
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
  const save = useCallback(async () => {
    // Each example line must still contain a form of the word to be blanked out; keep the form the
    // old line used when it is still there, else the headword.
    const lines = examples.split("\n").map((l) => l.trim()).filter(Boolean);
    const forms = [...new Set([...e.examples.map((x) => x.form), e.headword])];
    const exs = lines.map((s) => ({ sentence: s, form: forms.find((f) => s.includes(f)) ?? "" })).filter((x) => x.form);
    if (exs.length < lines.length && !confirm(`${lines.length - exs.length} example(s) do not contain the word and will be dropped. Save anyway?`)) return;
    await put(`/api/vocab/${w.id}`, { entry: { explanation, examples: exs.length ? exs : e.examples, confusable: conf.trim() && diff.trim() ? { word: conf.trim(), difference: diff.trim() } : null } });
    done();
  }, [explanation, examples, conf, diff]);
  return (
    <div className="new-course vocab-edit">
      <label>Explanation<textarea rows={2} value={explanation} onChange={(x) => setExplanation(x.target.value)} /></label>
      <label>Examples <span className="muted">(one per line; each must contain the word)</span><textarea rows={5} value={examples} onChange={(x) => setExamples(x.target.value)} /></label>
      <label>Confused with<input value={conf} onChange={(x) => setConf(x.target.value)} /></label>
      <label>The difference<textarea rows={2} value={diff} onChange={(x) => setDiff(x.target.value)} /></label>
      <div className="actions"><button className="primary" onClick={save}>Save</button><button onClick={done}>Cancel</button></div>
    </div>
  );
}
