// Text anchoring without a library. A selection is described by its exact text plus a little
// context on either side (W3C TextQuoteSelector); it is found again by searching the rendered
// text and painted with the CSS Custom Highlight API, which never touches React's DOM.

export type Quote = { quote: string; prefix: string; suffix: string };

// Flatten a container's text nodes so character offsets map back to DOM positions.
function textMap(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  while (walker.nextNode()) { const n = walker.currentNode as Text; nodes.push({ node: n, start: text.length }); text += n.data; }
  const at = (off: number): [Text, number] => {
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].start <= off) return [nodes[i].node, off - nodes[i].start];
    return [nodes[0]?.node, 0];
  };
  return { text, at };
}

const CTX = 32;

// Describe the current selection relative to `root`, or null if it is not inside it.
export function describe(root: HTMLElement): (Quote & { rect: DOMRect }) | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const quote = range.toString();
  if (!quote.trim()) return null;
  const { text } = textMap(root);
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { quote, prefix: text.slice(Math.max(0, start - CTX), start), suffix: text.slice(start + quote.length, start + quote.length + CTX), rect: range.getBoundingClientRect() };
}

// Find a quote again. Exact match first; among several, the one whose context agrees best.
export function locate(root: HTMLElement, q: Quote): Range | null {
  const { text, at } = textMap(root);
  let i = -1, best = -1, bestScore = -1;
  while ((i = text.indexOf(q.quote, i + 1)) >= 0) {
    const score = (q.prefix && text.slice(Math.max(0, i - q.prefix.length), i).endsWith(q.prefix.slice(-12)) ? 1 : 0)
                + (q.suffix && text.slice(i + q.quote.length).startsWith(q.suffix.slice(0, 12)) ? 1 : 0);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best < 0) return null;
  const range = document.createRange();
  range.setStart(...at(best));
  range.setEnd(...at(best + q.quote.length));
  return range;
}

// Paint every quote that can still be found; returns the range for each id that was. A quote missing
// from the result no longer matches the text (the section was rewritten since it was highlighted).
export function paint(root: HTMLElement, quotes: (Quote & { id: string })[]): Record<string, Range> {
  const found: Record<string, Range> = {};
  for (const q of quotes) { const r = locate(root, q); if (r) found[q.id] = r; }
  const H = (globalThis as any).Highlight;
  if (H && CSS.highlights) CSS.highlights.set("notes", new H(...Object.values(found)));
  return found;
}

// Bring a range into view, a little below the top bar.
export function scrollToRange(r: Range) {
  const top = r.getBoundingClientRect().top + scrollY - 120;
  scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

// The sentence around the current selection, from its paragraph (or list item, quote, cell), for a
// vocabulary capture. Falls back to the paragraph's text when sentences cannot be told apart.
export function sentenceAround(): { word: string; sentence: string } | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const word = range.toString().trim();
  if (!word) return null;
  const el = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
  const block = el?.closest("p, li, blockquote, td, th, h1, h2, h3, h4, .msg, .quiz-prompt, label") ?? el;
  if (!block) return { word, sentence: "" };
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length, text = block.textContent ?? "";
  // Sentence ends: . ! ? followed by space and a capital or quote. Find the one before and after.
  const ends = [...text.matchAll(/[.!?]["”’)]?\s+(?=["“‘(]?[A-Z0-9])/g)].map((m) => m.index! + m[0].length);
  const from = Math.max(0, ...ends.filter((i) => i <= start));
  const to = ends.find((i) => i > start + word.length) ?? text.length;
  return { word, sentence: text.slice(from, to).trim().replace(/\s+/g, " ") };
}
