# Phase 0 — Spike results

Date: 2026-10-28. Goal from [roadmap.md](roadmap.md): prove that headless Claude Code runs on the subscription login, streams NDJSON, and can invoke a skill and a subagent from a web page.

## Verdict: passed

| Check | Result |
|---|---|
| `claude -p` works with **no** `ANTHROPIC_API_KEY` in the environment | Yes — `--output-format json` returned `"result":"ok"` in 1.3 s |
| Credential used | `claude auth status` → `authMethod: claude.ai`, `subscriptionType: max`, `apiProvider: firstParty`. `~/.claude/.credentials.json` holds an OAuth token with `user:inference` scope; no API key anywhere |
| Project skill loads headlessly | `system/init` event lists `spike-check` in `slash_commands`; `claude -p "/spike-check …"` ran the skill body |
| Project subagent loads and runs | `init` lists `spike-researcher`; stream shows an `Agent` tool call with `subagent_type: spike-researcher`; `result.subagent_stats.spawned = 1` |
| File write under `acceptEdits` | `Write` tool call → `spike/out/result.md` created with the expected content |
| Streaming to browser | NDJSON (`system`, `assistant`, `stream_event`, `user`, `result`) forwarded over SSE; page shows live tool calls, session id, model, turn count, cost estimate, exit code |
| Full run | 3 turns, 1 subagent, exit 0, ~40 s |

## What was built

```
.claude/skills/spike-check/SKILL.md   # skill: call subagent → write file → reply
.claude/agents/spike-researcher.md    # haiku subagent, no tools
spike/server.ts                       # Bun: POST /run spawns `claude -p` and streams NDJSON as SSE
spike/index.html                      # one button, live log, stats
```

Run with `bun run spike` → http://localhost:4100.

## Things learned that affect Phase 1

- **Nested-session env vars must be stripped** when the server is launched from inside Claude Code (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`); otherwise the child refuses to start. Harmless from a normal terminal, but the runner should always strip them.
- **`total_cost_usd` is list-price accounting** (`costBasis: "list"`), not a subscription charge. Show it as "equivalent API cost" or hide it; what matters is subscription usage.
- The `system/init` event is a good health check: it reports the model, the loaded skills (`slash_commands`), and the loaded agents, so the app can verify its `.claude/` setup on startup.
- `stream_event` text deltas and the full `assistant` message both arrive; the UI should render deltas for responsiveness and reconcile on the `assistant` message.
- Skill invocation as `claude -p "/name args"` works exactly like interactive mode — no need to inline the skill body into the prompt.
- Write/Edit paths come back absolute in `tool_use.input.file_path`; the indexer should relativize them against the project root.

## Not yet verified (deferred to Phase 1)

- `--json-schema` structured output for grading.
- `--resume` for multi-turn chat from the server.
- Rate-limit behaviour with 3+ parallel subagents doing WebSearch.
- A `PreToolUse` hook that denies writes outside `content/`.
