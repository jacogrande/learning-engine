// User state lives here (SQLite). Content Claude writes lives in files.
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { ROOT } from "./content";

export const db = new Database(join(ROOT, "data/app.db"), { create: true });
db.run("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
db.run(`
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY, course TEXT NOT NULL, quiz TEXT NOT NULL,
    answers TEXT NOT NULL, grade TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drafts (
    course TEXT NOT NULL, quiz TEXT NOT NULL, answers TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (course, quiz)
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, course TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT,
    status TEXT NOT NULL, started_at TEXT, finished_at TEXT, session_id TEXT, result TEXT, error TEXT
  );
`);

export const id = () => crypto.randomUUID().slice(0, 8);
export const now = () => new Date().toISOString();
