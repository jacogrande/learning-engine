// Checks shared by the renderer and the lint for ```chart, ```html and image references.
import YAML from "yaml";

// A ```chart fence: one Vega-Lite spec, JSON (or YAML).
export function parseChart(src: string): { spec: any; error: string | null } {
  try {
    const spec = /^\s*\{/.test(src) ? JSON.parse(src) : YAML.parse(src);
    if (!spec || typeof spec !== "object") return { spec: null, error: "chart: the block is not a Vega-Lite spec" };
    if (!spec.mark && !spec.layer && !spec.hconcat && !spec.vconcat && !spec.concat && !spec.facet && !spec.repeat) return { spec, error: "chart: no mark, layer or concat; is this Vega-Lite?" };
    if (spec.data?.url) return { spec, error: "chart: data must be inline under data.values, not a url" };
    return { spec, error: null };
  } catch (e) { return { spec: null, error: `chart: ${(e as Error).message}` }; }
}

// Problems a reader would see in a ```html mock: it runs with no network.
export function mockProblems(src: string): string[] {
  const out: string[] = [];
  if (!src.trim()) out.push("html: empty mock");
  if (/<(script|link|img|iframe)\b[^>]*\b(src|href)\s*=\s*["']?https?:/i.test(src) || /@import\s+url\(\s*["']?https?:/i.test(src)) out.push("html: loads from the network, which the mock frame blocks; inline it");
  if (/\bfetch\(|XMLHttpRequest/.test(src)) out.push("html: makes a network request, which the mock frame blocks");
  return out;
}

// Relative image paths in markdown, `![alt](images/x.png)`.
export const imageRefs = (body: string) =>
  [...body.replace(/^```[\s\S]*?^```/gm, "").matchAll(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)]
    .map((m) => ({ alt: m[1], src: m[2] })).filter((r) => !/^(?:[a-z]+:|\/|#)/i.test(r.src));
