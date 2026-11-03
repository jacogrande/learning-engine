// Check the music in course files before a learner sees it: every abc fence (one tune, no parser
// warnings, every bar full) and every ::youtube passage (form, times, and, over the network, that
// the video exists and can be embedded, with its title and channel so the author can confirm it is
// the recording the prose names). Run by generation jobs on the files they write.
//
//   bun run scripts/check-notation.ts <file.md|file.abc>...
//
// A .abc file holds one tune with no fence. Exits 1 when anything is wrong.
import { readFile } from "node:fs/promises";
import { notation } from "../app/server/lint";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: bun run scripts/check-notation.ts <file.md|file.abc>..."); process.exit(2); }

let bad = 0;
for (const f of files) {
  const src = await readFile(f, "utf8").catch(() => null);
  if (src == null) { console.log(`${f}: cannot read`); bad++; continue; }
  const body = f.endsWith(".abc") ? "```abc\n" + src.trim() + "\n```\n" : src;
  const problems = notation(body);
  const tunes = [...body.matchAll(/^```abc\n([\s\S]*?)^```/gm)].length;
  const passages = [...body.matchAll(/^::youtube\{([^}]*)\}/gm)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])));
  for (const p of passages) {
    if (!p.v) continue;
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${p.v}`)}`).catch(() => null);
    if (!r) problems.push(`::youtube v="${p.v}": could not reach YouTube to check it`);
    else if (!r.ok) problems.push(`::youtube v="${p.v}": YouTube says ${r.status} (${r.status === 401 || r.status === 403 ? "embedding is disabled" : "no such video, or it is private"})`);
    else { const j = (await r.json()) as { title: string; author_name: string }; console.log(`${f}: ::youtube v="${p.v}" t="${p.t ?? ""}" end="${p.end ?? ""}" is "${j.title}" from ${j.author_name}; caption "${p.title ?? ""}"`); }
  }
  if (problems.length) { bad++; for (const p of problems) console.log(`${f}: ${p}`); }
  else console.log(`${f}: ok (${tunes} score${tunes === 1 ? "" : "s"}, ${passages.length} passage${passages.length === 1 ? "" : "s"})`);
}
process.exit(bad ? 1 : 0);
