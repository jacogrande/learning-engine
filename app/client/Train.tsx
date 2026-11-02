// Train vocab: today's words, one task at a time. A new word is met once (explanation and one anchor
// sentence), then tested in sentences it has not seen. Each word stays in the session until it has
// three correct answers, with other words between them; a miss shows the full answer and the word
// comes back a few tasks later. The ladder moves when a word's turn ends. See docs/vocab-spec.md.
import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, useEvent } from "./api";
import { Markdown } from "./Markdown";
import { Link, Shell } from "./App";
import { DIFFICULTY, Ladder, RUNGS, type Context, type Counts, type Entry, type Example } from "./Vocab";

type Format = "meet" | "pick" | "recall" | "explain" | "use";
type Task = {
  word: string; format: Format; stage: number; headword: string; entry: Entry; contexts: Context[]; courseTerm: string | null;
  sentence: string; form: string; anchor: Example; prompt: string; hint?: string; options?: string[]; answer?: number; probe?: { question: string; answer: string };
};
type Grade = { result: "correct" | "partial" | "wrong" | "skipped"; note: string };
type Tally = { correct: number; wrong: number; attempts: number; done: boolean; stage: number; start: number; event?: string | null };

const MAX_ATTEMPTS = 6, GAP = 3;
const bold = (s: string, form: string) => s.replace(form, `**${form}**`);

export function TrainPage() {
  const [queue, setQueue] = useState<Task[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [criterion, setCriterion] = useState(3);
  const [i, setI] = useState(0);
  const tally = useRef<Record<string, Tally>>({});
  const [, bump] = useState(0);

  const load = useCallback(async () => {
    const s = await get<{ tasks: Task[]; counts: Counts; criterion: number }>("/api/vocab/train");
    tally.current = Object.fromEntries(s.tasks.map((t) => [t.word, { correct: 0, wrong: 0, attempts: 0, done: false, stage: t.stage, start: t.stage }]));
    setQueue(s.tasks); setCounts(s.counts); setCriterion(s.criterion); setI(0);
  }, []);
  useEffect(() => { load(); }, [load]);

  const crumbs = [{ label: "Courses", to: "/" }, { label: "Vocabulary", to: "/vocab" }, { label: "Train" }];
  if (!queue) return <Shell crumbs={crumbs} className="page"><h1>Train</h1></Shell>;

  // Put a follow-up task for this word GAP tasks ahead, so other words come between its recalls.
  const later = async (wid: string) => {
    const t = await get<Task>(`/api/vocab/${wid}/task`).catch(() => null);
    if (!t) return;
    setQueue((q) => { const at = Math.min(q!.length, i + 1 + GAP); return [...q!.slice(0, at), t, ...q!.slice(at)]; });
  };
  const endTurn = async (wid: string) => {
    const t = tally.current[wid];
    t.done = true;
    const r = await post<{ stage: number; event: string | null }>(`/api/vocab/${wid}/finish`, { correct: t.correct, wrong: t.wrong });
    t.stage = r.stage; t.event = r.event; bump((n) => n + 1);
  };
  const onMet = async (task: Task) => { await post(`/api/vocab/${task.word}/meet`); tally.current[task.word].stage = 1; await later(task.word); setI(i + 1); };
  const onGraded = async (task: Task, g: Grade) => {
    const t = tally.current[task.word];
    t.attempts++;
    if (g.result === "correct") t.correct++; else t.wrong++;
    const need = task.stage >= RUNGS.length ? 1 : criterion;
    if (t.correct >= need || t.attempts >= MAX_ATTEMPTS) await endTurn(task.word);
    else await later(task.word);
  };

  const task = queue[i];
  if (!task) return <Shell crumbs={crumbs} className="page train"><Summary tally={tally.current} queue={queue} counts={counts} again={load} /></Shell>;
  const words = Object.keys(tally.current), done = words.filter((w) => tally.current[w].done).length;
  return (
    <Shell crumbs={crumbs} className="page train">
      <div className="train-progress"><span style={{ width: `${(100 * done) / Math.max(1, words.length)}%` }} /></div>
      <p className="meta">{done} of {words.length} words done · {task.format === "meet" ? "new word" : `${RUNGS[Math.min(task.stage, RUNGS.length - 1)].toLowerCase()}${task.stage >= RUNGS.length ? " · upkeep" : ""}`}</p>
      {task.format === "meet"
        ? <Meet key={`${i}`} task={task} onDone={() => onMet(task)} />
        : <Attempt key={`${i}`} task={task} onGraded={(g) => onGraded(task, g)} onNext={() => setI(i + 1)} />}
    </Shell>
  );
}

// First meeting: the explanation and one clear sentence, nothing else to hold yet.
function Meet({ task, onDone }: { task: Task; onDone: () => void }) {
  const e = task.entry;
  useEffect(() => {
    const on = (ev: KeyboardEvent) => { if (ev.key === "Enter") { ev.preventDefault(); onDone(); } };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);
  return (
    <article className="train-card meet">
      <p className="kicker">New word</p>
      <h1>{e.headword}</h1>
      <p className="meta">{[e.pos, e.register].filter(Boolean).join(" · ")}</p>
      <p className="lede">{e.explanation}</p>
      <Markdown body={`> ${bold(task.anchor.sentence, task.anchor.form)}`} />
      {e.parts && <p className="muted">{e.parts}</p>}
      <div className="actions"><button className="primary" onClick={onDone}>Got it →</button><span className="muted">Enter. You'll be asked it in sentences you haven't seen.</span></div>
    </article>
  );
}

// One test: answer, rate how hard the recall was, check; then the full answer.
function Attempt({ task, onGraded, onNext }: { task: Task; onGraded: (g: Grade) => void; onNext: () => void }) {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState(0);
  const [phase, setPhase] = useState<"answer" | "grading" | "feedback">("answer");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = useRef(false);
  const input = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const land = (g: Grade) => { waiting.current = false; setGrade(g); setPhase("feedback"); onGraded(g); };
  useEvent("vgrade", useCallback((ev: any) => { if (waiting.current && ev.id === task.word && ev.mode === "train") land({ result: ev.result, note: ev.note }); }, [task.word]));

  const answer = task.format === "pick" ? (picked !== null ? task.options![picked] : "") : value;
  const ready = !!answer.trim() && difficulty > 0 && phase === "answer";
  const check = async () => {
    if (!ready) return;
    setPhase("grading"); waiting.current = true; setError(null);
    const result = task.format === "pick" ? (picked === task.answer ? "correct" : "wrong") : undefined;
    try {
      const r = await post<{ job: string | null; result?: Grade["result"]; note?: string }>(`/api/vocab/${task.word}/answer`, {
        format: task.format, sentence: task.sentence, form: task.form, answer, difficulty, mode: "train", result, probe: task.probe,
      });
      if (!r.job && r.result) land({ result: r.result, note: r.note ?? "" });
    } catch { waiting.current = false; setPhase("answer"); setError("That did not reach the server. Try again."); }
  };
  const skip = () => { setValue(""); setDifficulty(1); setPhase("grading"); waiting.current = true; post(`/api/vocab/${task.word}/answer`, { format: task.format, sentence: task.sentence, form: task.form, answer: "", difficulty: 1, mode: "train" }).then((r: any) => { if (r.result) land({ result: r.result, note: "" }); }); };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT";
      if (!typing && phase === "answer" && /^[123]$/.test(e.key)) { setDifficulty(Number(e.key)); e.preventDefault(); }
      if (e.altKey && /^[123]$/.test(e.key) && phase === "answer") { setDifficulty(Number(e.key)); e.preventDefault(); }
      if (e.key === "Enter" && !e.shiftKey) {
        if (phase === "answer" && ready) { e.preventDefault(); check(); }
        else if (phase === "feedback") { e.preventDefault(); onNext(); }
      }
    };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  });

  const right = grade?.result === "correct";
  return (
    <article className={`train-card ${grade ? `is-${grade.result}` : ""}`}>
      <p className="kicker">{task.format === "pick" ? "Pick the word" : task.format === "recall" ? "Recall the word" : task.format === "explain" ? "Recall the meaning" : "Use it"}</p>
      <div className="train-prompt"><Markdown body={task.prompt} /></div>
      {task.format === "pick" ? (
        <div className="quiz-options">
          {task.options!.map((o, k) => (
            <label key={o} className={phase === "feedback" ? (k === task.answer ? "is-answer" : k === picked ? "is-wrong" : "") : ""}>
              <input type="radio" name="pick" checked={picked === k} disabled={phase !== "answer"} onChange={() => setPicked(k)} /> {o}
            </label>
          ))}
        </div>
      ) : task.format === "recall" ? (
        <input ref={input} className="field train-input" value={value} disabled={phase !== "answer"} onChange={(e) => setValue(e.target.value)} placeholder={task.hint} autoComplete="off" spellCheck={false} />
      ) : (
        <textarea ref={input} className="field train-input" rows={3} value={value} disabled={phase !== "answer"} onChange={(e) => setValue(e.target.value)} placeholder="Your answer" />
      )}
      {task.format === "recall" && phase === "answer" && <p className="meta">Hint: {task.hint}</p>}

      {phase !== "feedback" ? (
        <div className="quiz-actions">
          <span className="confidence" role="group" aria-label="How hard was it to recall?">
            {DIFFICULTY.map((d, k) => <button key={d} type="button" aria-pressed={difficulty === k + 1} disabled={phase !== "answer"} onClick={() => setDifficulty(k + 1)}>{d}</button>)}
          </span>
          <button className="primary" disabled={!ready} onClick={check} title={!difficulty ? "Rate how hard the recall was first" : undefined}>{phase === "grading" ? "Grading…" : "Check"}</button>
          {phase === "answer" && <button className="link" onClick={skip}>I don't know</button>}
          {error && <span className="muted">{error}</span>}
        </div>
      ) : (
        <div className="train-feedback">
          <p><span className="quiz-status">{grade!.result}</span> {grade!.note}</p>
          {/* The full answer, every time: after a miss it is what does the teaching. */}
          <div className="train-answer">
            {task.format === "pick" || task.format === "recall"
              ? <Markdown body={`> ${bold(task.sentence, task.form)}`} />
              : task.probe ? <p>{task.probe.answer}</p> : null}
            <p><strong>{task.headword}</strong>: {task.entry.explanation}</p>
            {/* Near-neighbours are contrasted once the word is known, from the meaning rung on. */}
            {task.stage >= 3 && task.entry.confusable && <p className="muted">Not {task.entry.confusable.word}: {task.entry.confusable.difference}</p>}
          </div>
          <div className="actions"><button className="primary" autoFocus onClick={onNext}>Next →</button><span className="muted">{right ? "" : "It comes back in a few cards."} Enter</span></div>
        </div>
      )}
      <p className="meta keys">1 · 2 · 3 how hard it was (Alt+1–3 while typing) &nbsp; Enter check / next</p>
    </article>
  );
}

function Summary({ tally, queue, counts, again }: { tally: Record<string, Tally>; queue: Task[]; counts: Counts | null; again: () => void }) {
  const words = Object.entries(tally);
  const head = (wid: string) => queue.find((t) => t.word === wid)?.headword ?? wid;
  if (!words.length) return (
    <>
      <h1>Train</h1>
      {counts?.total ? (
        <p className="muted empty">Nothing to train right now. Every word has had today's session; they come back tomorrow, because sleeping on a word is part of learning it. Due review cards are on the <Link to="/review">Review</Link> page.</p>
      ) : (
        <p className="muted empty">No words yet. Select a word in a lesson and choose Vocab (or press V), or press Alt+V anywhere.</p>
      )}
      <p className="actions"><Link to="/vocab" className="btn">Vocabulary</Link></p>
    </>
  );
  const climbed = words.filter(([, t]) => t.event === "climb").length;
  return (
    <>
      <h1>Done for today</h1>
      <p className="lede">{words.length} words, {climbed} up a rung. Spacing makes the next session feel harder than this one ended. That is the part that makes words stick.</p>
      <ul className="train-summary">
        {words.map(([wid, t]) => (
          <li key={wid}>
            <Link to={`/vocab#w-${wid}`}>{head(wid)}</Link>
            <Ladder stage={t.stage} />
            <span className="muted">{t.correct} right{t.wrong ? `, ${t.wrong} missed` : ""}{t.event === "climb" ? " · up a rung" : t.event === "drop" ? " · down a rung" : t.done && t.correct >= 3 && t.wrong === 0 && t.stage === t.start && t.start < 5 ? " · climbs next session" : ""}</span>
          </li>
        ))}
      </ul>
      <p className="actions"><Link to="/vocab" className="btn">Vocabulary</Link><button onClick={again}>Check for more</button></p>
    </>
  );
}
