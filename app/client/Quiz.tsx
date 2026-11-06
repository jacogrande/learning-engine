// A single question. Three modes: form (baseline; a parent collects answers), review (read-only
// with the grader's note), and live (in a lesson; answers persist, short ones are graded, and a
// confidence rating is taken before feedback — calibration is part of what the course measures).
import { createContext, useContext, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Answer, Result, Sheet } from "./api";

export type QuizSpec = {
  id: string; type: "mcq" | "short"; prompt: string; objective?: string;
  options?: string[]; answer?: number; explanation?: string; rubric?: string;
};

// Defined once: a new `p` component on every render would remount the text, and a reader's
// selection inside a prompt or a grader's note would vanish when the selection menu opens.
const unwrapP = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> };
const Inline = ({ children }: { children: string }) => <ReactMarkdown components={unwrapP}>{children}</ReactMarkdown>;

// The baseline form: each question takes an answer, how sure the learner is, and an optional note.
export const QuizForm = createContext<{ sheet: Sheet; set: (field: keyof Sheet, id: string, v: string | number) => void } | null>(null);
export type QuestionResult = { result: Result; note: string };
export const QuizReview = createContext<{ sheet: Sheet; results: Record<string, QuestionResult> } | null>(null);
// `scale` replaces the confidence labels (vocab cards ask how hard the recall was instead).
// `chat`, where a chat pane exists, opens a chat seeded with the question, the answer and its feedback.
// `cancel` stops a short answer's grade in flight; it resolves false when the grade already landed.
export const QuizGrade = createContext<{ saved: Record<string, Answer>; submit: (spec: QuizSpec, answer: string, confidence: number) => void; scale?: string[]; chat?: (context: string) => void; cancel?: (spec: QuizSpec) => Promise<boolean> } | null>(null);

const CONFIDENCE = ["Guessing", "Fairly sure", "Sure"];

// The chat context for a graded answer. The server recognises the leading "Question: " and tells the
// tutor this is feedback to discuss, not a selected passage.
const feedbackContext = (spec: QuizSpec, answer: string, a: Answer) =>
  `Question: ${spec.prompt.trim()}\n\nMy answer: ${answer.trim()}\n\nFeedback${a.result ? ` (${a.result})` : ""}: ${a.note!.trim()}`;

export function Quiz({ spec }: { spec: QuizSpec }) {
  const review = useContext(QuizReview);
  if (review) return <Review spec={spec} answer={review.sheet.answers[spec.id]} confidence={review.sheet.confidence[spec.id]} remark={review.sheet.notes[spec.id]} result={review.results[spec.id]} />;
  return <Live spec={spec} />;
}

function Review({ spec, answer, confidence, remark, result }: { spec: QuizSpec; answer?: string; confidence?: number; remark?: string; result?: QuestionResult }) {
  const status = result?.result ?? (answer ? "pending" : "skipped");
  return (
    <div className={`quiz quiz-review is-${status}`}>
      <p className="quiz-prompt"><Inline>{spec.prompt}</Inline><span className="quiz-status">{status}</span></p>
      {spec.type === "mcq" ? (
        <div className="quiz-options">
          {spec.options?.map((o, i) => (
            <div key={i} className={`${i === spec.answer ? "is-answer" : ""} ${String(i) === answer && i !== spec.answer ? "is-wrong" : ""}`}>
              <span className="mark">{String(i) === answer ? "●" : "○"}</span> {o}
            </div>
          ))}
        </div>
      ) : (
        <blockquote className="quiz-answer">{answer || <span className="muted">No answer</span>}</blockquote>
      )}
      {answer && (confidence || remark?.trim()) && (
        <p className="quiz-remark muted">{confidence ? CONFIDENCE[confidence - 1] : ""}{confidence && remark?.trim() ? " · " : ""}{remark?.trim()}</p>
      )}
      {result?.note && <p className="quiz-explain"><Inline>{result.note}</Inline></p>}
    </div>
  );
}

function Live({ spec }: { spec: QuizSpec }) {
  const form = useContext(QuizForm);
  const grade = useContext(QuizGrade);
  const saved = grade?.saved[spec.id];
  const [value, setValue] = useState(saved?.answer ?? "");
  const [confidence, setConfidence] = useState<number>(saved?.confidence ?? 0);
  const [checked, setChecked] = useState(!!saved);
  // Answers can arrive after the lesson renders; adopt them unless the learner has typed something new.
  useEffect(() => {
    if (!saved || (value !== "" && value !== saved.answer)) return;
    setValue(saved.answer); setConfidence(saved.confidence ?? 0); setChecked(!saved.failed);
  }, [saved?.answer, saved?.result, saved?.note, saved?.failed]);
  const v = form ? form.sheet.answers[spec.id] ?? "" : value;
  const set = (x: string) => { form ? form.set("answers", spec.id, x) : setValue(x); setChecked(false); };

  const correct = spec.type === "mcq" && spec.answer != null && v === String(spec.answer);
  const grading = checked && spec.type === "short" && grade && saved?.answer === v && !saved?.note && !saved?.result;
  const status: Result | null = checked ? (spec.type === "mcq" ? (correct ? "correct" : "wrong") : saved?.answer === v ? saved?.result ?? null : null) : null;
  const needConfidence = !!grade && !confidence;
  const sureAndWrong = !grade?.scale && status === "wrong" && (saved?.confidence ?? confidence) === 3;

  const check = () => { setChecked(true); grade?.submit(spec, v, confidence); };
  // Back to editing, with the text kept: the grade is dropped and nothing is rated.
  const [cancelling, setCancelling] = useState(false);
  const cancel = () => { setCancelling(true); grade?.cancel?.(spec).then((ok) => { if (ok) setChecked(false); }, () => {}).finally(() => setCancelling(false)); };

  return (
    <div className={`quiz ${status ? `is-${status}` : ""}`}>
      {spec.prompt.includes("\n")
        ? <div className="quiz-prompt quiz-prompt-block">{status && <span className="quiz-status">{status}</span>}<ReactMarkdown>{spec.prompt}</ReactMarkdown></div>
        : <p className="quiz-prompt"><Inline>{spec.prompt}</Inline>{status && <span className="quiz-status">{status}</span>}</p>}
      {spec.type === "mcq" ? (
        <div className="quiz-options">
          {spec.options?.map((o, i) => (
            <label key={i} className={checked ? (i === spec.answer ? "is-answer" : v === String(i) ? "is-wrong" : "") : ""}>
              <input type="radio" name={spec.id} checked={v === String(i)} onChange={() => set(String(i))} /> {o}
            </label>
          ))}
        </div>
      ) : (
        <textarea rows={3} value={v} onChange={(e) => set(e.target.value)} placeholder="Your answer" />
      )}
      {form && (
        <div className="quiz-actions quiz-form-extra">
          <span className="confidence" role="group" aria-label="How sure are you?">
            {CONFIDENCE.map((c, i) => <button key={c} type="button" aria-pressed={form.sheet.confidence[spec.id] === i + 1} onClick={() => form.set("confidence", spec.id, i + 1)}>{c}</button>)}
          </span>
          {v && !form.sheet.confidence[spec.id] && <span className="muted">How sure are you?</span>}
          <textarea className="quiz-note" rows={1} value={form.sheet.notes[spec.id] ?? ""} onChange={(e) => form.set("notes", spec.id, e.target.value)}
            placeholder="Notes on your answer (optional)" aria-label="Notes on your answer (optional)" />
        </div>
      )}
      {!form && (
        <div className="quiz-actions">
          {grade && !checked && (
            <span className="confidence" role="group" aria-label={grade.scale ? "How hard was it to recall?" : "How sure are you?"}>
              {(grade.scale ?? CONFIDENCE).map((c, i) => <button key={c} type="button" aria-pressed={confidence === i + 1} onClick={() => setConfidence(i + 1)}>{c}</button>)}
            </span>
          )}
          <button className="primary" onClick={check} disabled={!v || checked || needConfidence} title={needConfidence ? (grade?.scale ? "Rate how hard the recall was first" : "Pick how sure you are first") : undefined}>{grading ? "Grading…" : "Check"}</button>
          {grading && grade?.cancel && <button type="button" onClick={cancel} disabled={cancelling} title="Stop grading and keep editing this answer">{cancelling ? "Cancelling…" : "Cancel"}</button>}
          {spec.type === "short" && grade && !checked && saved && (saved.failed ? <span className="muted" role="alert">{saved.note}</span> : <span className="muted">Edited since last check</span>)}
        </div>
      )}
      {sureAndWrong && <p className="quiz-explain hyper">You were sure. Errors held with confidence are the ones that stick once corrected — read the note below slowly.</p>}
      {checked && !form && spec.type === "mcq" && spec.explanation && <p className="quiz-explain"><Inline>{spec.explanation}</Inline></p>}
      {checked && !form && spec.type === "short" && (
        grade ? (saved?.note && saved.answer === v ? <>
                  <p className="quiz-explain"><Inline>{saved.note}</Inline></p>
                  {grade.chat && <p className="quiz-chat"><button className="link" onClick={() => grade.chat!(feedbackContext(spec, v, saved))}>Chat about this</button></p>}
                </> : null)
              : spec.rubric ? <p className="quiz-explain"><Inline>{spec.rubric}</Inline></p> : null
      )}
      {!form && saved?.history && saved.history.length > 0 && (
        <details className="quiz-history">
          <summary>Earlier answers ({saved.history.length})</summary>
          <ol reversed>
            {[...saved.history].reverse().map((h, i) => (
              <li key={i}>
                <span className="muted">{h.gradedAt ? new Date(h.gradedAt).toLocaleDateString() : "ungraded"}{h.result ? ` · ${h.result}` : ""}</span>
                <blockquote>{spec.type === "mcq" ? spec.options?.[Number(h.answer)] ?? h.answer : h.answer}</blockquote>
                {h.note && <p className="muted"><Inline>{h.note}</Inline></p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
