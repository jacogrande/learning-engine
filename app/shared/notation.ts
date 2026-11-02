// Checks for music notation and recorded passages, shared by the reader (which shows the problems
// under the block) and the module lint (which reports them right after generation). Pure functions
// over abcjs's parsed tune and the directive's attribute strings; no DOM.

// A passage time: "1:43", "1:42.5", "1:02:03", "103", "103s", "1m43s". null when absent, NaN when
// present but unreadable, so a typo is an error, never a silent 0.
export function toSeconds(t?: string | null): number | null {
  if (t == null || String(t).trim() === "") return null;
  const s = String(t).trim();
  let m = /^(\d+(?:\.\d+)?)s?$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(?=\d)(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(s);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return NaN;
}

export const YOUTUBE_ID = /^[\w-]{11}$/;

// What is wrong with a ::youtube directive's attributes, if anything.
export function youtubeProblems(a: { v?: string; t?: string; end?: string }): string[] {
  const out: string[] = [];
  if (!a.v || !YOUTUBE_ID.test(a.v)) out.push(`video id "${a.v ?? ""}" is not 11 characters of letters, digits, - or _`);
  const t = toSeconds(a.t), end = toSeconds(a.end);
  if (Number.isNaN(t)) out.push(`t="${a.t}" is not a time (use m:ss, seconds, or 1m43s)`);
  if (Number.isNaN(end)) out.push(`end="${a.end}" is not a time (use m:ss, seconds, or 1m43s)`);
  if (t != null && end != null && !Number.isNaN(t) && !Number.isNaN(end) && end <= t) out.push(`end (${a.end}) is not after t (${a.t})`);
  return out;
}

// Problems in an abc fence's source before parsing: one tune per fence, and something to play.
export function abcSourceProblems(src: string): string[] {
  if (!src.trim()) return ["the block is empty"];
  const tunes = src.match(/^X:/gm)?.length ?? 0;
  return tunes > 1 ? [`${tunes} tunes in one block; put each tune in its own fence`] : [];
}

// A blank line ends an ABC tune, which would drop every line after it without a word. Inside a fence
// a blank line can only have been meant as spacing, so it is removed.
export const tidyAbc = (src: string) => src.replace(/\n[ \t]*(?=\n)/g, "").trim();

const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

// Problems in a parsed tune (abcjs's TuneObject): its parser warnings, and bars whose notes do not add
// up to the meter. abcjs never checks bar length, and a slip like an unquoted chord name ("G7 DFAc")
// reads as a seven-eighths G with no warning at all. A short first bar is a pickup and a short last
// bar its complement; any other bar must be full.
export function tuneProblems(tune: any): string[] {
  const out = (tune?.warnings ?? []).map((w: string) => strip(w));
  if (!tune?.lines?.length) return [...out, "no music: the block has headers but no notes"];
  const m = tune.getMeterFraction?.();
  if (!m?.num || !m?.den) return out;   // free meter: nothing to check
  const full = m.num / m.den;
  // Bars per voice, carried across line breaks: a bar may continue on the next line.
  const bars = new Map<string, number[]>(), open = new Map<string, number>();
  tune.lines.forEach((line: any) => (line.staff ?? []).forEach((st: any, si: number) => (st.voices ?? []).forEach((voice: any[], vi: number) => {
    const key = `${si}:${vi}`;
    let sum = open.get(key) ?? 0, mult = 1;
    for (const el of voice) {
      if (el.el_type === "bar") { if (sum > 1e-6) (bars.get(key) ?? bars.set(key, []).get(key)!).push(sum); sum = 0; continue; }
      if (el.el_type !== "note") continue;
      if (el.startTriplet) mult = el.tripletMultiplier ?? 1;
      sum += (el.duration ?? 0) * mult;
      if (el.endTriplet) mult = 1;
    }
    open.set(key, sum);
  })));
  for (const [key, rest] of open) if (rest > 1e-6) (bars.get(key) ?? bars.set(key, []).get(key)!).push(rest);
  const eighths = (x: number) => { const n = Math.round(x * 8 * 1000) / 1000; return `${n} eighth${n === 1 ? "" : "s"}`; };
  for (const [key, list] of bars) list.forEach((sum, i) => {
    const edge = i === 0 || i === list.length - 1;
    if (sum > full + 1e-6 || (!edge && sum < full - 1e-6))
      out.push(`bar ${i + 1}${bars.size > 1 ? ` (voice ${Number(key.split(":")[1]) + 1})` : ""} holds ${eighths(sum)}; ${m.num}/${m.den} needs ${eighths(full)}`);
  });
  return out;
}
