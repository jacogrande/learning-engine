// Spaced review. Every question the learner answers becomes an FSRS card; the Review tab serves
// what is due. "Learned" means three spaced correct recalls (streak >= 3 in the Review state).
import { fsrs, createEmptyCard, Rating, State, type Card, type Grade } from "ts-fsrs";
import YAML from "yaml";
import { db, now } from "./db";
import { getDoc } from "./content";
import { state } from "./state";

const scheduler = fsrs({ request_retention: 0.9 });

export type Result = "correct" | "partial" | "wrong" | "skipped";

// Result + confidence → FSRS rating. A confident correct answer earns Easy; a guess only Good.
export function rating(result: Result, confidence?: number | null): Grade {
  if (result === "correct") return confidence === 3 ? Rating.Easy : Rating.Good;
  if (result === "partial") return Rating.Hard;
  return Rating.Again;
}

export function rate(course: string, question: string, doc: string, result: Result, confidence?: number | null) {
  const row = db.query("SELECT card, streak, log FROM cards WHERE course=? AND question=?").get(course, question) as any;
  const prev: Card = row ? revive(JSON.parse(row.card)) : createEmptyCard(new Date());
  const r = rating(result, confidence);
  const { card, log } = scheduler.next(prev, new Date(), r);
  const streak = r === Rating.Again ? 0 : (row?.streak ?? 0) + 1;
  const logs = [...(row ? JSON.parse(row.log) : []), { ...log, result, confidence: confidence ?? null }];
  const module = /^modules\/([^/]+)\//.exec(doc)?.[1] ?? null;
  db.run(`INSERT INTO cards (course, question, doc, module, due, card, streak, log, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(course, question) DO UPDATE SET doc=excluded.doc, module=excluded.module, due=excluded.due, card=excluded.card, streak=excluded.streak, log=excluded.log, updated_at=excluded.updated_at`,
    [course, question, doc, module, card.due.toISOString(), JSON.stringify(card), streak, JSON.stringify(logs), now()]);
  state.card(course, question);
  return { due: card.due, streak, learned: streak >= 3 && card.state === State.Review };
}

const revive = (c: any): Card => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });

// Pull a quiz block out of a doc by id.
export async function question(course: string, doc: string, qid: string) {
  const d = await getDoc(course, doc);
  if (!d) return null;
  for (const m of d.body.matchAll(/```quiz\n([\s\S]*?)```/g)) {
    try { const q = YAML.parse(m[1]); if (q?.id === qid) return q; } catch {}
  }
  return null;
}

export async function due(course: string, limit = 20) {
  const rows = db.query("SELECT question, doc, module, due, streak FROM cards WHERE course=? AND due<=? ORDER BY due LIMIT ?").all(course, now(), limit) as any[];
  const items = [];
  for (const r of rows) {
    const spec = await question(course, r.doc, r.question);
    if (spec) items.push({ ...r, spec });
  }
  const total = (db.query("SELECT count(*) n FROM cards WHERE course=?").get(course) as any).n;
  const next = (db.query("SELECT min(due) d FROM cards WHERE course=? AND due>?").get(course, now()) as any).d;
  return { items, dueCount: rows.length, total, next };
}

// Per-module mastery from the cards: how many questions are "learned".
export function mastery(course: string) {
  const rows = db.query("SELECT module, question, streak, card FROM cards WHERE course=? AND module IS NOT NULL").all(course) as any[];
  const by: Record<string, { questions: number; learned: number }> = {};
  for (const r of rows) {
    const m = (by[r.module] ??= { questions: 0, learned: 0 });
    m.questions++;
    if (r.streak >= 3 && JSON.parse(r.card).state === State.Review) m.learned++;
  }
  return by;
}
