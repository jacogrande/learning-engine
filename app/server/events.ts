// One SSE channel. Content changes on disk and job progress both flow through here.
import { watch } from "node:fs";
import { COURSES_DIR } from "./content";

const clients = new Set<ReadableStreamDefaultController>();
const enc = new TextEncoder();

export function broadcast(data: unknown) {
  const frame = enc.encode(`data: ${JSON.stringify(data)}\n\n`);
  for (const c of clients) { try { c.enqueue(frame); } catch { clients.delete(c); } }
}

export function sse(req: Request) {
  let ctrl: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(c) { ctrl = c; clients.add(c); c.enqueue(enc.encode(": hi\n\n")); },
    cancel() { clients.delete(ctrl); },
  });
  req.signal.addEventListener("abort", () => clients.delete(ctrl));
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

// Claude writes via temp file + rename, so watch the directory tree and debounce bursts.
let timer: ReturnType<typeof setTimeout> | undefined;
export function watchContent() {
  try {
    watch(COURSES_DIR, { recursive: true }, (_e, file) => {
      if (!file || /\.tmp\.|\.git\//.test(String(file))) return;
      clearTimeout(timer);
      timer = setTimeout(() => broadcast({ type: "content" }), 300);
    });
  } catch (e) { console.warn("content watch unavailable:", (e as Error).message); }
}
