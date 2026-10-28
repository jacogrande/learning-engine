// A single question. In "form" mode (baseline) answers are collected by a parent; otherwise it self-checks.
import { createContext, useContext, useState } from "react";
import ReactMarkdown from "react-markdown";

const Inline = ({ children }: { children: string }) => (
  <ReactMarkdown components={{ p: ({ children }) => <>{children}</> }}>{children}</ReactMarkdown>
);

export type QuizSpec = {
  id: string; type: "mcq" | "short"; prompt: string;
  options?: string[]; answer?: number; explanation?: string; rubric?: string;
};

export const QuizForm = createContext<{ answers: Record<string, string>; set: (id: string, v: string) => void } | null>(null);

// Read-only: the learner's saved answer plus the grader's note.
export type QuestionResult = { result: "correct" | "partial" | "wrong" | "skipped"; note: string };
export const QuizReview = createContext<{ answers: Record<string, string>; results: Record<string, QuestionResult> } | null>(null);

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
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState(false);
  const v = form ? form.answers[spec.id] ?? "" : value;
  const set = (x: string) => { form ? form.set(spec.id, x) : setValue(x); setChecked(false); };

  const correct = spec.type === "mcq" && spec.answer != null && v === String(spec.answer);

  return (
    <div className="quiz">
      <p className="quiz-prompt"><Inline>{spec.prompt}</Inline></p>
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
          <button onClick={() => setChecked(true)} disabled={!v}>Check</button>
          {checked && spec.type === "mcq" && <span className={correct ? "ok" : "muted"}>{correct ? "Correct" : "Not quite"}</span>}
        </div>
      )}
      {checked && !form && (spec.explanation || spec.rubric) && (
        <p className="quiz-explain"><Inline>{spec.explanation ?? spec.rubric ?? ""}</Inline></p>
      )}
    </div>
  );
}
