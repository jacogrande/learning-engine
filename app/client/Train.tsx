// Train vocab: today's words, one task at a time. A new word is met once (explanation and one anchor
// sentence), then tested in sentences it has not been shown. Each word stays in the session until it
// has three correct answers, with other words between them; every answer shows the full answer, and
// the word comes back a few tasks later. The ladder moves when a word's turn ends. The session is kept
// on the server as it goes, so a refresh or a lost connection resumes it. See docs/vocab-spec.md.
import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, put, useEvent } from "./api";
import { Markdown } from "./Markdown";
import { Link, Shell } from "./App";
import { DONE, Ladder, RUNGS, bold, inDialog, toast, type Counts, type Task } from "./Vocab";

type Grade = { result: "correct" | "partial" | "wrong" | "skipped"; note: string };
type Tally = { correct: number; wrong: number; attempts: number; done: boolean; stage: number; start: number; event?: string | null; unsent?: boolean };
// A follow-up whose task is fetched when it comes up, so it uses the sentences asked by then.
type Slot = Task | { word: string; placeholder: true; key: string };
// A grade in flight when the page was left; picked up again on return.
type Pending = { i: number; job: string };
type Saved = { day: string; i: number; queue: Slot[]; tally: Record<string, Tally>; pending?: Pending | null };

const MAX_ATTEMPTS = 6, GAP = 3;
const isTask = (s: Slot | undefined): s is Task => !!s && !("placeholder" in s);
const today = () => { const d = new Date(); return new Date(+d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const draftKey = (i: number, word: string) => `train-draft:${today()}:${i}:${word}`;
const store = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch {} } };

export function TrainPage() {
  const [queue, setQueue] = useState<Slot[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [criterion, setCriterion] = useState(3);
  const [i, setI] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loadError, setLoadError] = useState(false);
  const tally = useRef<Record<string, Tally>>({});
  const [version, bump] = useState(0);

  const load = useCallback(async (fresh = false) => {
    setLoadError(false);
    try {
      const s = await get<{ tasks: Task[]; counts: Counts; criterion: number; resume?: Saved }>(`/api/vocab/train${fresh ? "?fresh=1" : ""}`);
      setCounts(s.counts); setCriterion(s.criterion);
      if (s.resume) {
        tally.current = s.resume.tally ?? {};
        for (const t of s.resume.queue) tally.current[t.word] ??= { correct: 0, wrong: 0, attempts: 0, done: false, stage: isTask(t) ? t.stage : 0, start: isTask(t) ? t.stage : 0 };
        setQueue(s.resume.queue); setI(s.resume.i); setPending(s.resume.pending ?? null); return;
      }
      tally.current = Object.fromEntries(s.tasks.map((t) => [t.word, { correct: 0, wrong: 0, attempts: 0, done: false, stage: t.stage, start: t.stage }]));
      setQueue(s.tasks); setI(0); setPending(null);
    } catch { setLoadError(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Keep the session on the server after every step; clear it once finished.
  useEffect(() => {
    if (!queue) return;
    const finished = i >= queue.length;
    const body: Saved | null = finished || !queue.length ? null : { day: today(), i, queue, tally: tally.current, pending };
    const t = setTimeout(() => put("/api/vocab/train/session", body).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [queue, i, pending, version]);

  // A follow-up slot that comes up gets its task now.
  const slot = queue?.[i];
  useEffect(() => {
    if (!slot || isTask(slot)) return;
    const key = slot.key;
    get<Task>(`/api/vocab/${slot.word}/task`).then(
      (t) => setQueue((q) => q!.map((x) => ("key" in x && x.key === key ? t : x))),
      () => { toast("The next task did not load; that word is skipped for now.", null, true); setQueue((q) => q!.filter((x) => !("key" in x && x.key === key))); },
    );
  }, [slot]);

  const crumbs = [{ label: "Courses", to: "/" }, { label: "Vocabulary", to: "/vocab" }, { label: "Train" }];
  if (!queue) return (
    <Shell crumbs={crumbs} className="page"><h1>Train</h1>
      {loadError && <p className="muted empty">Today's session did not load. <button className="link" onClick={() => load()}>Try again</button></p>}
    </Shell>
  );

  const endTurn = async (wid: string) => {
    const t = tally.current[wid];
    if (t.done && !t.unsent) return;   // a word's turn ends once: a second finish could drop it again
    t.done = true; bump((n) => n + 1);
    try { const r = await post<{ stage: number; event: string | null }>(`/api/vocab/${wid}/finish`, { correct: t.correct, wrong: t.wrong }); t.stage = r.stage; t.event = r.event; t.unsent = false; }
    catch { t.unsent = true; }
    bump((n) => n + 1);
  };
  // The word comes back after GAP other tasks, or at the end if fewer are left. With no other word
  // left to put between, its turn ends: straight after its answer was shown, a recall tests nothing.
  const later = (wid: string, at: number) => {
    const ahead = queue.slice(at + 1).filter((s) => s.word !== wid);
    if (!ahead.length) return endTurn(wid);
    setQueue((q) => {
      let seen = 0, pos = q!.length;
      for (let k = at + 1; k < q!.length; k++) if (q![k].word !== wid && ++seen === GAP) { pos = k + 1; break; }
      return [...q!.slice(0, pos), { word: wid, placeholder: true, key: `${wid}:${Date.now()}` }, ...q!.slice(pos)];
    });
  };
  const onMet = async (task: Task) => {
    await post(`/api/vocab/${task.word}/meet`);
    tally.current[task.word].stage = 1;
    later(task.word, i); setI(i + 1);
  };
  const onGraded = (task: Task, g: Grade) => {
    setPending(null);
    if (task.bonus) return;   // a family question: logged by the server, outside the ladder
    const t = tally.current[task.word];
    t.attempts++;
    if (g.result === "correct") t.correct++; else t.wrong++;
    setPending(null); bump((n) => n + 1);
    const need = task.stage >= DONE ? 1 : criterion;
    if (t.correct >= need || t.attempts >= MAX_ATTEMPTS) endTurn(task.word);
    else later(task.word, i);
  };
  // Leave a task whose grade could not be had, without counting it.
  const pass = () => { setPending(null); const t = isTask(slot) && !slot.bonus ? tally.current[slot.word] : null; if (t && !queue.slice(i + 1).some((s) => s.word === slot!.word)) endTurn(slot!.word); setI(i + 1); };

  if (!slot) return <Shell crumbs={crumbs} className="page train"><Summary tally={tally.current} queue={queue} counts={counts} criterion={criterion} again={() => load(true)} resend={endTurn} /></Shell>;
  const words = Object.keys(tally.current), done = words.filter((w) => tally.current[w].done).length;
  return (
    <Shell crumbs={crumbs} className="page train">
      <div className="train-progress" role="progressbar" aria-label="Words done" aria-valuemin={0} aria-valuemax={words.length} aria-valuenow={done}><span style={{ width: `${(100 * done) / Math.max(1, words.length)}%` }} /></div>
      {!isTask(slot) ? <p className="meta">Loading the next task…</p> : <>
        <p className="meta">{done} of {words.length} words done · {slot.format === "meet" ? "new word" : slot.bonus ? "family · extra practice" : `${RUNGS[Math.min(slot.stage, DONE - 1)].toLowerCase()}${slot.stage >= DONE ? " · upkeep" : ""}`}</p>
        {slot.format === "meet"
          ? <Meet key={i} task={slot} onDone={() => onMet(slot)} />
          : <Attempt key={i} i={i} task={slot} pending={pending?.i === i ? pending : null} onSent={(job) => setPending(job ? { i, job } : null)} onGraded={(g) => onGraded(slot, g)} onPass={pass} onNext={() => setI(i + 1)} />}
      </>}
    </Shell>
  );
}

// First meeting: the explanation and one clear sentence, nothing else to hold yet.
function Meet({ task, onDone }: { task: Task; onDone: () => Promise<void> }) {
  const e = task.entry;
  const busy = useRef(false);
  const [error, setError] = useState(false);
  const go = async () => {
    if (busy.current) return;
    busy.current = true; setError(false);
    try { await onDone(); } catch { setError(true); busy.current = false; }
  };
  useEffect(() => {
    const on = (ev: KeyboardEvent) => { if (ev.key === "Enter" && !inDialog(ev) && !ev.defaultPrevented) { ev.preventDefault(); go(); } };
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
      <div className="actions"><button className="primary" autoFocus onClick={go}>Got it →</button><span className="muted">Enter. You'll be asked it in sentences you haven't seen.</span>{error && <span className="muted" role="alert">That did not reach the server. Try again.</span>}</div>
    </article>
  );
}

// One test: answer, check; then the full answer. Train asks no effort rating: the ladder moves on
// correctness alone. A grade is waited for by its event, with polling as the fallback.
function Attempt({ i, task, pending, onSent, onGraded, onPass, onNext }: { i: number; task: Task; pending: Pending | null; onSent: (job: string | null) => void; onGraded: (g: Grade) => void; onPass: () => void; onNext: () => void }) {
  const dk = draftKey(i, task.word);
  const [value, setValue] = useState(() => store.get(dk) ?? "");
  const [picked, setPicked] = useState<number | null>(null);
  const [phase, setPhase] = useState<"answer" | "grading" | "feedback" | "error">(pending ? "grading" : "answer");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<string | null>(pending?.job ?? null);
  const input = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { (input.current ?? first.current)?.focus(); }, []);
  useEffect(() => { store.set(dk, value || null); }, [value]);

  const land = (g: Grade) => { if (phase === "feedback") return; job.current = null; store.set(dk, null); setGrade(g); setPhase("feedback"); onGraded(g); };
  const fail = (msg: string) => { job.current = null; onSent(null); setError(msg); setPhase("error"); };
  const landRef = useRef(land); landRef.current = land;
  const failRef = useRef(fail); failRef.current = fail;
  useEvent("vgrade", useCallback((ev: any) => {
    if (!job.current || ev.job !== job.current) return;
    ev.error ? failRef.current(ev.error) : landRef.current({ result: ev.result, note: ev.note ?? "" });
  }, []));
  // Fallback for a missed event (a refresh mid-grade, a dropped connection).
  useEffect(() => {
    if (phase !== "grading") return;
    const t = setInterval(() => {
      if (!job.current) return;
      get<any>(`/api/vocab/grades/${job.current}`).then((g) => { if (g.error) failRef.current(g.error); else if (g.result) landRef.current({ result: g.result, note: g.note ?? "" }); }, () => {});
    }, 4000);
    return () => clearInterval(t);
  }, [phase]);

  const choice = task.format === "pick" || task.format === "kin-pick";
  const answer = choice ? (picked !== null ? task.options![picked] : "") : value;
  const ready = !!answer.trim() && phase === "answer";
  const send = async (text: string) => {
    setPhase("grading"); setError(null);
    const result = choice ? (picked === task.answer ? "correct" : "wrong") : undefined;
    try {
      const r = await post<{ job: string | null; result?: Grade["result"]; note?: string }>(`/api/vocab/${task.word}/answer`, {
        format: task.format, sentence: task.sentence, form: task.form, answer: text, mode: "train", result, probe: task.probe, kin: task.kin ? { word: task.kin.word, sense: task.kin.sense } : undefined,
      });
      if (r.job) { job.current = r.job; onSent(r.job); }
      else if (r.result) land({ result: r.result, note: r.note ?? "" });
    } catch (e) { fail(typeof e === "number" ? `The server refused the answer (${e}).` : "That did not reach the server. Your answer is kept; try again."); }
  };
  const check = () => { if (ready) send(answer); };
  const skip = () => { setValue(""); send(""); };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (inDialog(e) || e.defaultPrevented) return;
      const el = e.target as HTMLElement, typing = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type === "text");
      if (!typing && choice && phase === "answer" && /^[1-9]$/.test(e.key) && Number(e.key) <= task.options!.length) { setPicked(Number(e.key) - 1); e.preventDefault(); }
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
      <p className="kicker">{task.format === "pick" ? "Pick the word" : task.format === "recall" ? "Recall the word" : task.format === "explain" ? "Recall the meaning" : task.format === "kin-pick" ? "Pick from the family" : task.format === "kin-explain" ? "Work out a family member" : "Use it"}</p>
      <div className="train-prompt" id={`prompt-${i}`}><Markdown body={task.prompt} /></div>
      {choice ? (
        <div className="quiz-options" role="radiogroup" aria-labelledby={`prompt-${i}`}>
          {task.options!.map((o, k) => (
            <label key={o} className={phase === "feedback" ? (k === task.answer ? "is-answer" : k === picked ? "is-wrong" : "") : ""}>
              <input ref={k === 0 ? first : undefined} type="radio" name="pick" checked={picked === k} disabled={phase !== "answer"} onChange={() => setPicked(k)} /> {o} <span className="muted keys">{k + 1}</span>
            </label>
          ))}
        </div>
      ) : task.format === "recall" ? (
        <input ref={input} className="field train-input" aria-labelledby={`prompt-${i}`} value={value} disabled={phase !== "answer"} onChange={(e) => setValue(e.target.value)} placeholder={task.hint} autoComplete="off" spellCheck={false} />
      ) : (
        <textarea ref={input} className="field train-input" aria-labelledby={`prompt-${i}`} rows={3} value={value} disabled={phase !== "answer"} onChange={(e) => setValue(e.target.value)} placeholder="Your answer" />
      )}
      {task.format === "recall" && phase === "answer" && <p className="meta">Hint: {task.hint}</p>}

      {phase === "answer" || phase === "grading" ? (
        <div className="quiz-actions">
          <button className="primary" disabled={!ready} onClick={check}>{phase === "grading" ? "Grading…" : "Check"}</button>
          {phase === "answer" && <button className="link" onClick={skip}>I don't know</button>}
        </div>
      ) : phase === "error" ? (
        <div className="quiz-actions" role="alert">
          <span className="muted">{error}</span>
          <button className="primary" onClick={() => send(answer)}>Try again</button>
          <button className="link" onClick={onPass}>Skip this one</button>
        </div>
      ) : null}
      <div aria-live="polite">
        {phase === "feedback" && (
          <div className="train-feedback">
            <p><span className="quiz-status">{grade!.result}</span> {grade!.note}</p>
            {/* The full answer, every time: after a miss it is what does the teaching. */}
            <div className="train-answer">
              {task.format === "pick" || task.format === "recall" || task.format === "kin-pick"
                ? <Markdown body={`> ${bold(task.sentence, task.form)}`} />
                : task.probe ? <p>{task.probe.answer}</p> : null}
              {/* A family question's answer is the member: its meaning, how it relates, an example. */}
              {task.kin ? <>
                <p><strong>{task.kin.word}</strong> <span className="muted">{task.kin.relation}</span>: {task.kin.sense}</p>
                {task.format === "kin-explain" && task.kin.example && <Markdown body={`> ${bold(task.kin.example.sentence, task.kin.example.form)}`} />}
              </> : <p><strong>{task.headword}</strong>: {task.entry.explanation}</p>}
              {/* Near-neighbours are contrasted once the word is known, from the meaning rung on. */}
              {task.stage >= 3 && task.entry.confusable && <p className="muted">Not {task.entry.confusable.word}: {task.entry.confusable.difference}</p>}
            </div>
            <div className="actions"><button className="primary" autoFocus onClick={onNext}>Next →</button><span className="muted">{right || task.bonus ? "" : "It comes back in a few cards."} Enter</span></div>
          </div>
        )}
      </div>
      <p className="meta keys">{choice ? `1–${task.options!.length} choose · ` : ""}Enter check / next{task.format !== "recall" && !choice ? " · Shift+Enter new line" : ""}</p>
    </article>
  );
}

function Summary({ tally, queue, counts, criterion, again, resend }: { tally: Record<string, Tally>; queue: Slot[]; counts: Counts | null; criterion: number; again: () => void; resend: (wid: string) => void }) {
  const words = Object.entries(tally);
  // A turn whose end did not reach the server is sent again.
  useEffect(() => { for (const [wid, t] of words) if (t.unsent) resend(wid); }, []);
  const head = (wid: string) => queue.find((t): t is Task => isTask(t) && t.word === wid)?.headword ?? wid;
  const c = counts;
  const why = !c?.total ? "No words yet. Select a word in a lesson and choose Vocab (or press V), or press Ctrl+V anywhere."
    : [
        c.pending ? `${c.pending} ${c.pending === 1 ? "entry is" : "entries are"} still being written; ${c.pending === 1 ? "it joins" : "they join"} Train when ready.` : "",
        c.failed ? `${c.failed} ${c.failed === 1 ? "entry" : "entries"} failed; try again from the Vocabulary page.` : "",
        c.reviewFirst ? `${c.reviewFirst} ${c.reviewFirst === 1 ? "word is" : "words are"} due in Review today. Review first, then come back.` : "",
        c.held ? `${c.held} new ${c.held === 1 ? "word waits" : "words wait"} until a word it is easily confused with is further up the ladder.` : "",
        c.trainedToday ? "The rest have had today's session. They come back tomorrow: sleeping on a word is part of learning it." : "",
      ].filter(Boolean).join(" ") || "Nothing to train right now.";
  if (!words.length) return (
    <>
      <h1>Train</h1>
      <p className="muted empty">{why}</p>
      <p className="actions"><Link to="/vocab" className="btn">Vocabulary</Link>{c?.reviewFirst ? <Link to="/review" className="btn primary">Review</Link> : null}</p>
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
            <span className="muted">{t.correct} right{t.wrong ? `, ${t.wrong} missed` : ""}{t.unsent ? " · not saved yet" : t.event === "climb" ? " · up a rung" : t.event === "drop" ? " · down a rung" : t.done && t.correct >= criterion && t.wrong === 0 && t.stage === t.start && t.start < DONE ? " · climbs next session" : ""}</span>
          </li>
        ))}
      </ul>
      <p className="actions"><Link to="/vocab" className="btn">Vocabulary</Link><button onClick={again}>Check for more</button></p>
    </>
  );
}

