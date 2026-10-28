# Research: Driving Claude Code from a local web app

Research date: 2026-10-27. Compiled from the official Claude Code / Agent SDK docs. Items marked **[unverified]** could not be confirmed from primary sources.

## The crux: authentication and billing

The requirement is that all generation is billed to the user's Claude Code subscription (Pro/Max), not a pay-per-token API key.

What the docs say:

- The **Agent SDK** docs state: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in this document instead."* ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview.md))
- The **`claude` CLI** itself, once the user has run `claude` and logged in with their claude.ai account, runs `claude -p ...` against that login. This is how every existing open-source "Claude Code web UI" project works: they spawn the user's own installed CLI and parse its JSON output.
- `claude --bare` skips loading hooks/skills/plugins **and does not use the subscription login** — it needs `ANTHROPIC_API_KEY`. Don't use `--bare` if subscription billing matters.

Interpretation for this project: the SDK policy is about *distributing a product* to other people on their claude.ai logins. A single-user, personal tool that shells out to the `claude` binary the user already installed and logged in with is the same thing as the user running `claude -p` in their terminal. The safest technical path is therefore to spawn the installed CLI rather than depend on the SDK's auth behaviour. **Verify in two minutes:** with `ANTHROPIC_API_KEY` unset, run `claude -p "say hi" --output-format json` and confirm it succeeds and that `claude /status` (or the usage page) attributes it to the subscription.

Whether the SDK's bundled binary picks up the CLI login when no API key is set is **[unverified]**; treat the SDK as API-key-only unless tested.

## 1. Claude Agent SDK

Packages: `@anthropic-ai/claude-agent-sdk` (TypeScript, [repo](https://github.com/anthropics/claude-agent-sdk-typescript)), `claude-agent-sdk` (Python, [repo](https://github.com/anthropics/claude-agent-sdk-python)). Both bundle the Claude Code binary.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Generate module 3",
  options: {
    cwd: "/path/to/project",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Agent"],
    permissionMode: "acceptEdits",
    includePartialMessages: true,   // stream_event deltas for token streaming
  },
})) {
  if (message.type === "stream_event") { /* token delta */ }
  if (message.type === "assistant")    { /* full assistant turn */ }
  if (message.type === "result")       { /* session_id, total_cost_usd, structured_output */ }
}
```

Notable options:
- `systemPrompt` (replace) — CLI equivalent `--append-system-prompt` (append). CLAUDE.md and `.claude/rules/*.md` in `cwd` load automatically.
- `allowedTools`, `disallowedTools`, `permissionMode` (`acceptEdits` | `auto` | `plan` | `dontAsk` | `default`), `canUseTool` callback for programmatic approval.
- `resume: sessionId` for multi-turn; `listSessions`, `renameSession`, `forkSession` helpers. Transcripts live in `~/.claude/` as `.jsonl`.
- `outputFormat: { type: "json_schema", schema }` → `result.structured_output` (absent if Claude declined).
- `agents` option / `.claude/agents/*.md` for subagents; `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` env var caps parallelism.
- Hooks and MCP servers are supported identically to the CLI.
- `total_cost_usd` is a client-side estimate, not billing. On a resumed session it includes earlier turns.

## 2. Headless CLI (`claude -p`)

```bash
# stream NDJSON events (system, assistant, stream_event, result)
claude -p "prompt" --output-format stream-json --verbose --include-partial-messages

# structured output
claude -p "Grade this" --output-format json --json-schema '{"type":"object",...}'

# multi-turn
SESSION=$(claude -p "start" --output-format json | jq -r .session_id)
claude -p "continue" --resume "$SESSION"

# permissions
claude -p "..." --allowedTools "Read,Write,Edit,WebSearch" --permission-mode acceptEdits

# extra instructions, inline agents, budget
claude -p "..." --append-system-prompt "..." --agents '{"researcher":{"tools":"Read,WebSearch,WebFetch","model":"opus"}}' --max-turns 40 --max-budget-usd 5
```

- `--input-format stream-json` keeps one process alive and lets you push user messages into it (persistent chat process). `--resume` per message is the stateless alternative.
- Invoking a skill headlessly works: `claude -p "/start-course lean methodology"` **[unverified: the CLI accepts slash-command prompts in `-p` mode per the skills docs, but confirm the clarifying-question step behaves sensibly without a TTY]**.

## 3. Skills / slash commands

`.claude/skills/<name>/SKILL.md`:

```yaml
---
name: start-course
description: Scaffold a new course from a topic
allowed-tools: "Read,Write,Agent,WebSearch,WebFetch"
argument-hint: "<topic>"
context: fork            # run in an isolated subagent context
disable-model-invocation: true   # only runnable via /start-course
---
Topic: $ARGUMENTS
...
```

- `!`command`` lines inject shell output into the prompt before Claude sees it.
- `context: fork` isolates the skill in its own context; `default` runs inline.

## 4. Subagents

`.claude/agents/<name>.md`:

```yaml
---
name: topic-researcher
description: Breadth-first research on a subject
tools: Read,WebSearch,WebFetch,Write
model: opus
permissionMode: acceptEdits
maxTurns: 25
---
system prompt body...
```

Subagents can use WebSearch/WebFetch if listed in `tools`. Claude invokes them by description or explicit `@name` / "use the X agent". Parallel fan-out is controlled by `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`.

## 5. Hooks

Events: `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionStart`, `SessionEnd`, `FileChanged`, `Notification`.

Hook types: `command`, `http`, `prompt`, `agent`. An `http` hook on `PostToolUse` matching `Write|Edit` can POST the event to a local server — usable for "file written → index + hot reload". A `command` hook on `PreToolUse` can return `{ "decision": "deny" }` to block writes outside an allowed directory.

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{ "type": "http", "url": "http://localhost:3001/api/hooks/file-written" }]
    }]
  }
}
```

## 6. Structured output

Both SDK (`outputFormat`) and CLI (`--json-schema`) validate against a JSON Schema and retry. Suitable for quiz grading results, understanding summaries, outline JSON.

## 7. Concurrency and limits

- Multiple `claude -p` / SDK sessions can run concurrently in the same directory; each has its own session id and transcript.
- Rate limits are account-level. Many parallel subagents share the one subscription limit. Start with 2–3 concurrent subagents and a single app-level job queue; watch for 429s.

## 8. Existing open-source wrappers (prior art)

| Project | Mechanism |
|---|---|
| [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) | Node server spawns the CLI, streams over WebSocket, session browser, mobile UI |
| [fafawlf/claude-code-web](https://github.com/fafawlf/claude-code-web) | Self-hosted workspace; HTTP/WS bridge to CLI |
| Companion (The-Vibe-Company) | Bun + Hono backend bridging CLI NDJSON to a React frontend, including permission approval from the browser |
| [sunpix/claude-code-web](https://github.com/sunpix/claude-code-web), [vultuk/claude-code-web](https://github.com/vultuk/claude-code-web) | Terminal-style browser UIs with streaming |
| claude-agent-server (Ruby gem) | REST + SSE wrapper over the Agent SDK |

All of them confirm the pattern: a small local server, `spawn("claude", ["-p", ..., "--output-format", "stream-json"])`, parse NDJSON, forward to the browser.

## Sources

- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview.md) · [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript.md) · [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output) · [Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking.md)
- [Headless mode](https://code.claude.com/docs/en/headless.md) · [Hooks](https://code.claude.com/docs/en/hooks-guide.md) · [Subagents](https://code.claude.com/docs/en/sub-agents.md) · [Skills](https://code.claude.com/docs/en/skills.md)
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
