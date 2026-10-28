# Phase 2 — Interact

Date: 2026-10-28. Goal from [roadmap.md](roadmap.md): highlight a sentence, drill into it, ask Claude about it, keep notes — and have all of it survive regeneration.

## Verdict: done

Verified end to end on a throwaway copy of a real module, with real Claude jobs:

| Feature | Result |
|---|---|
| Selection menu | Appears above any selection in the article: Note · Drill down · Reading · Chat |
| Highlights | Saved as quote + 32 chars of context; re-found in the rendered text and painted with the CSS Custom Highlight API (no DOM mutation); survive reload |
| Notes | Tiptap 3 with the official markdown extension; one file per module in `data/notes/<slug>/<module>.md`; "Note" inserts the quote as a blockquote with its source; debounced save |
| In-lesson grading | MCQ checks locally and saves; short answers run `/grade` (structured `result` + `note`) and the note appears under the question — 9 s on the light lane |
| Chat | Scoped to a section, optionally seeded with a selection; first turn runs `/chat`, later turns `--resume` the session; tokens stream over SSE; messages and session id in SQLite |
| Drill-down | `/drill-down` with optional guidance wrote a 500-word companion doc with a quiz; shows in the sidebar under its source section with a back-link |
| Additional reading | `/find-reading` writes a `readings/` doc the same way |
| Two lanes | Heavy (module, drill-down, reading, assess, outline) and light (grade, chat) each run one at a time, so a chat never waits behind a 10-minute build |
| Git auto-commit | Each finished heavy job commits `content/` with a `Run-Id: <job>` trailer |

## What was built

```
app/server/jobs.ts       lanes, text-delta streaming hook, auto-commit
app/server/content.ts    extras (drilldowns/, readings/) per module; fault-tolerant frontmatter
app/server.ts            answers, annotations, notes, chats, drill-down, reading routes
app/client/Reader.tsx    three panes, selection menu, highlight painting, quiz grading context
app/client/selection.ts  describe / locate / paint — ~60 lines, no library
app/client/Notes.tsx     Tiptap editor ↔ markdown file
app/client/Chat.tsx      chat list, thread with streaming, composer
.claude/skills/          grade, chat, drill-down, find-reading
```

## Decisions

- **Feedback lives in SQLite, not appended to the lesson file.** The feasibility doc proposed `:::feedback` blocks in the doc. Storing per-question rows keyed by quiz id is simpler, never mutates Claude-written files, and renders in place. Same outcome for the reader.
- **Highlights anchor by quote + context, not by block id.** Section prose has no stable ids yet; the quote selector re-finds text after regeneration as long as the sentence survives. Orphaned highlights are still listed in the pane.
- **Chat and grading don't show in the job bar** — they report progress in place ("Grading…", "Thinking…"). The bar is for the long jobs.
- **The tutor withholds answers by design** (`chat` skill): hint first, full answer after an attempt, and it says so once.

## Found and fixed while testing

- A drill-down wrote `quote: That frame is the main clause: …` — an unquoted colon in YAML frontmatter — and one bad file 500'd the whole course. The parser now falls back to a line-wise read, and the skills quote that field.
- The sticky chat composer sat 40 px above the pane bottom; the chat pane now scrolls its thread and pins the composer.

## Carried to Phase 3

- Heading "…" menu (section-scoped actions without selecting text).
- Clicking a highlight to jump to its note.
- Stable ids on prose blocks (quotes anchor well enough for now).
- End-of-module summary and Socratic chat, understanding summary, mastery gate, spaced review.
