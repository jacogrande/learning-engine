// Phase 0 spike: a button on a page spawns `claude -p` and streams its NDJSON back over SSE.
// Run with `bun run spike`, open http://localhost:4100.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PORT = Number(process.env.PORT ?? 4100);

// Env for the child. Strip anything that would make `claude` think it is a nested session
// (matters only when the server itself is started from inside Claude Code) and make sure
// no API key leaks in — the point of the spike is to run on the subscription login.
function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "CLAUDE_PID") delete env[k];
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = "2";
  return env;
}

function runClaude(prompt: string) {
  const args = [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read,Write,Agent",
    "--max-turns", "20",
  ];
  return spawn("claude", args, { cwd: ROOT, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(Bun.file(resolve(import.meta.dir, "index.html")), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/run" && req.method === "POST") {
      const { prompt } = (await req.json()) as { prompt: string };
      const child = runClaude(prompt);
      const enc = new TextEncoder();

      const stream = new ReadableStream({
        start(controller) {
          const send = (event: string, data: unknown) =>
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

          send("spawn", { pid: child.pid, args: child.spawnargs.slice(1) });

          // stdout is NDJSON: one JSON object per line.
          let buf = "";
          child.stdout.on("data", (chunk) => {
            buf += chunk.toString();
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i).trim();
              buf = buf.slice(i + 1);
              if (!line) continue;
              try { send("claude", JSON.parse(line)); } catch { send("raw", line); }
            }
          });
          child.stderr.on("data", (chunk) => send("stderr", chunk.toString()));
          child.on("close", (code) => { send("exit", { code }); controller.close(); });
          req.signal.addEventListener("abort", () => child.kill("SIGTERM"));
        },
      });

      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Spike: http://localhost:${PORT}`);
