// Generate one image for a lesson through OpenRouter and save it in the course, next to the prompt
// that made it. Run by generation jobs when a section needs a picture no chart, diagram or mock can draw.
//
//   bun run scripts/gen-image.ts <path/images/name.png> "<prompt>" [--aspect 16:9] [--quality medium] [--model <id>]
//
// The path must sit in an images/ folder under library/content/courses/ (or LEARNING_DIR). The prompt is
// saved beside the image as <name>.prompt.txt, so the image can be remade or revised later.
// OPENROUTER_API_KEY comes from the environment or the repo's .env. OPENROUTER_IMAGE_MODEL overrides
// the default model. Exits 1 on failure, with the reason.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, basename, extname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_MODEL = "openai/gpt-image-2.6-sunburst";   // OpenAI's detail tier: dense layouts and legible text
const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "4:5", "5:4"];
const QUALITIES = ["low", "medium", "high"];

// Bun loads .env from the working directory only; jobs may run elsewhere.
async function env(key: string) {
  if (process.env[key]) return process.env[key];
  const src = await readFile(join(ROOT, ".env"), "utf8").catch(() => "");
  const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "m").exec(src);
  return m?.[1].trim().replace(/^(['"])(.*)\1$/, "$2");
}

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const aspect = flag("aspect") ?? "16:9";
const quality = flag("quality") ?? "medium";   // about $0.03 an image; high is about four times that
const modelArg = flag("model");
const [out, ...words] = args;
const prompt = words.join(" ").trim();
const fail = (msg: string, code = 1) => { console.error(msg); process.exit(code); };

if (!out || !prompt) fail('usage: bun run scripts/gen-image.ts <path/images/name.png> "<prompt>" [--aspect 16:9] [--quality medium] [--model <id>]', 2);
if (!ASPECTS.includes(aspect)) fail(`--aspect must be one of ${ASPECTS.join(", ")}`, 2);
if (!QUALITIES.includes(quality)) fail(`--quality must be one of ${QUALITIES.join(", ")}`, 2);
const library = resolve(process.env.LEARNING_DIR ?? join(ROOT, "library"), "content/courses");
const target = resolve(out);
if (!target.startsWith(library + "/")) fail(`the image must go under ${library}/`, 2);
if (basename(dirname(target)) !== "images") fail("the image must go in an images/ folder, next to the section that shows it", 2);
if (![".png", ".jpg", ".jpeg", ".webp"].includes(extname(target).toLowerCase())) fail("name the file .png, .jpg or .webp", 2);

const key = await env("OPENROUTER_API_KEY");
if (!key) fail("OPENROUTER_API_KEY is not set (environment or .env)");
const model = modelArg ?? (await env("OPENROUTER_IMAGE_MODEL")) ?? DEFAULT_MODEL;

// OpenRouter's Image API: image-only models are not served on chat/completions.
const format = { ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" }[extname(target).toLowerCase()] ?? "png";
const res = await fetch("https://openrouter.ai/api/v1/images", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Learning" },
  body: JSON.stringify({ model, prompt, n: 1, aspect_ratio: aspect, quality, output_format: format }),
  signal: AbortSignal.timeout(240_000),
}).catch((e) => fail(`could not reach OpenRouter: ${(e as Error).message}`) as never);
const body = (await res.json().catch(() => null)) as any;
if (!res.ok) fail(`OpenRouter ${res.status}: ${body?.error?.message ?? JSON.stringify(body)}`);

const b64: string | undefined = body?.data?.[0]?.b64_json;
if (!b64) fail(`no image in the reply: ${JSON.stringify(body).slice(0, 400)}`);
const bytes = Buffer.from(b64!, "base64");

await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
await writeFile(target.replace(/\.[^.]+$/, ".prompt.txt"), `model: ${model}\naspect: ${aspect}\nquality: ${quality}\n\n${prompt}\n`);
const cost = body?.usage?.cost;
console.log(`${out}: ${(bytes.length / 1024).toFixed(0)} KB from ${model}${cost != null ? `, $${Number(cost).toFixed(3)}` : ""}`);
