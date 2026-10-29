// Spaced review: due questions from anywhere in the course, one at a time, graded like a lesson.
import { useCallback, useEffect, useState } from "react";
import { get, post, useLive, type Answer, type Course } from "./api";
import { Quiz, QuizGrade, type QuizSpec } from "./Quiz";
import { Link, Shell } from "./App";

type Due = { items: { question: string; doc: string; module: string | null; due: string; streak: number; spec: QuizSpec }[]; dueCount: number; total: number; next: string | null; mastery: Record<string, { questions: number; learned: number }> };

export function ReviewPage({ slug }: { slug: string }) {
  const { data: course } = useLive<Course>(`/api/courses/${slug}`);
  const [due, setDue] = useState<Due | null>(null);
  const [i, setI] = useState(0);
  const [saved, setSaved] = useState<Record<string, Answer>>({});
  const load = useCallback(() => get<Due>(`/api/courses/${slug}/review`).then((d) => { setDue(d); setI(0); setSaved({}); }), [slug]);
  useEffect(() => { load(); }, [load]);

  const item = due?.items[i];
  const submit = useCallback((spec: QuizSpec, answer: string, confidence: number) => {
    if (!item) return;
    const result = spec.type === "mcq" ? (answer === String(spec.answer) ? "correct" : "wrong") : undefined;
    setSaved((s) => ({ ...s, [spec.id]: { question: spec.id, answer, result: result ?? null, note: null, job: null, confidence, gradedAt: null } }));
    post(`/api/courses/${slug}/answers`, { question: spec.id, doc: item.doc, answer, type: spec.type, result, confidence }).then(() => {
      if (spec.type === "short") poll(spec.id, item.doc);
    });
  }, [item, slug]);
  const poll = (qid: string, doc: string) => {
    const t = setInterval(() => get<Answer[]>(`/api/courses/${slug}/answers?doc=${doc}`).then((as) => {
      const a = as.find((x) => x.question === qid);
      if (a?.note) { clearInterval(t); setSaved((s) => ({ ...s, [qid]: a })); }
    }), 1500);
  };

  if (!course || !due) return null;
  const modTitle = (id: string | null) => course.modules.find((m) => m.id === id)?.title ?? id;
  const answered = item && saved[item.spec.id];
  const graded = answered && (answered.result || answered.note);
  return (
    <Shell crumbs={[{ label: "Courses", to: "/" }, { label: course.title, to: `/c/${slug}` }, { label: "Review" }]} className="page">
      <h1>Review</h1>
      {due.items.length === 0 ? (
        <p className="muted empty">Nothing due. {due.total} question{due.total === 1 ? "" : "s"} scheduled{due.next ? `; next on ${new Date(due.next).toLocaleDateString()}` : ""}. <Link to={`/c/${slug}`}>Back to the outline →</Link></p>
      ) : item ? (
        <>
          <p className="muted">{i + 1} of {due.items.length} due · from <Link to={`/c/${slug}/m/${item.module}/${item.doc.split("/").slice(2).join("/")}`}>{modTitle(item.module)}</Link>{item.streak > 0 ? ` · ${item.streak} correct in a row` : ""}</p>
          <QuizGrade value={{ saved, submit }}>
            <Quiz key={item.question} spec={item.spec} />
          </QuizGrade>
          <div className="actions">
            <button className="primary" disabled={!graded} onClick={() => setI(i + 1)}>{i + 1 < due.items.length ? "Next →" : "Done"}</button>
            {answered && !graded && <span className="muted">Grading…</span>}
          </div>
        </>
      ) : (
        <p className="muted empty">That's everything for now. <button className="link" onClick={load}>Check again</button> · <Link to={`/c/${slug}`}>Outline →</Link></p>
      )}
    </Shell>
  );
}
