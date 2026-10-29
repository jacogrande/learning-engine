// A single question. Three modes: form (baseline; a parent collects answers), review (read-only
// with the grader's note), and live (in a lesson; answers persist, short ones are graded, and a
// confidence rating is taken before feedback — calibration is part of what the course measures).
import { createContext, useContext, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Answer, Result } from "./api";

export type QuizSpec = {
  id: string; type: "mcq" | "short"; prompt: string; objective?: string;
  options?: string[]; answer?: number; explanation?: string; rubric?: string;
};

const Inline = ({ children }: { children: string }) => (
  <ReactMarkdown components={{ p: ({ children }) => <>{children}</> }}>{children}</ReactMarkdown>
);

export const QuizForm = createContext<{ answers: Record<string, string>; set: (id: string, v: string) => void } | null>(null);
export type QuestionResult = { result: Result; note: string };
export const QuizReview = createContext<{ answers: Record<string, string>; results: Record<string, QuestionResult> } | null>(null);
export const QuizGrade = createContext<{ saved: Record<string, Answer>; submit: (spec: QuizSpec, answer: string, confidence: number) => void } | null>(null);

const CONFIDENCE = ["Guessing", "Fairly sure", "Sure"];

export function Quiz({ spec }: { spec: QuizSpec }) {
  const review = useContext(QuizReview);
  if (review) return <Review spec={spec} answer={review.answers[spec.id]} result={review.results[spec.id]} />;
  return <Live spec={spec} />;
}

function Review({ spec, answer, result }: { spec: QuizSpec; answer?: string; result?: QuestionResult }) {
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
  const v = form ? form.answers[spec.id] ?? "" : value;
  const set = (x: string) => { form ? form.set(spec.id, x) : setValue(x); setChecked(false); };

  const correct = spec.type === "mcq" && spec.answer != null && v === String(spec.answer);
  const grading = checked && spec.type === "short" && grade && saved?.answer === v && !saved?.note;
  const status: Result | null = checked ? (spec.type === "mcq" ? (correct ? "correct" : "wrong") : saved?.answer === v ? saved?.result ?? null : null) : null;
  const needConfidence = !!grade && !confidence;
  const sureAndWrong = status === "wrong" && (saved?.confidence ?? confidence) === 3;

  const check = () => { setChecked(true); grade?.submit(spec, v, confidence); };

  return (
    <div className={`quiz ${status ? `is-${status}` : ""}`}>
      <p className="quiz-prompt"><Inline>{spec.prompt}</Inline>{status && <span className="quiz-status">{status}</span>}</p>
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
      {!form && (
        <div className="quiz-actions">
          {grade && !checked && (
            <span className="confidence" role="group" aria-label="How sure are you?">
              {CONFIDENCE.map((c, i) => <button key={c} type="button" aria-pressed={confidence === i + 1} onClick={() => setConfidence(i + 1)}>{c}</button>)}
            </span>
          )}
          <button className="primary" onClick={check} disabled={!v || checked || needConfidence} title={needConfidence ? "Pick how sure you are first" : undefined}>{grading ? "Grading…" : "Check"}</button>
          {spec.type === "short" && grade && !checked && saved && <span className="muted">Edited since last check</span>}
        </div>
      )}
      {sureAndWrong && <p className="quiz-explain hyper">You were sure. Errors held with confidence are the ones that stick once corrected — read the note below slowly.</p>}
      {checked && !form && spec.type === "mcq" && spec.explanation && <p className="quiz-explain"><Inline>{spec.explanation}</Inline></p>}
      {checked && !form && spec.type === "short" && (
        grade ? (saved?.note && saved.answer === v ? <p className="quiz-explain"><Inline>{saved.note}</Inline></p> : null)
              : spec.rubric ? <p className="quiz-explain"><Inline>{spec.rubric}</Inline></p> : null
      )}
    </div>
  );
}
