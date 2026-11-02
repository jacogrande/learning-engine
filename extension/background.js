// "Add to Vocab" on selected text in any page: sends the word, the sentence it sits in, and the page's
// title and address to the Learning app on this machine, which writes the entry in the background.
const APP = "http://127.0.0.1:4000";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "add-vocab", title: "Add to Vocab", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "add-vocab") return;
  const word = (info.selectionText ?? "").trim();
  if (!word) return;
  // The sentence around the selection, read in the page. Some pages (the browser's own, the web
  // store, PDFs) do not allow scripts; the word is still added, without a sentence.
  let sentence = "";
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId ?? 0] }, func: sentenceAround });
    sentence = r?.result ?? "";
  } catch {}
  try {
    const res = await fetch(`${APP}/api/vocab`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ word, context: sentence, title: tab?.title ?? null, url: info.pageUrl ?? tab?.url ?? null }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return notify("Not added", body.error ?? `The app answered ${res.status}.`);
    const name = body.word?.entry?.headword ?? body.word?.word ?? word;
    notify(body.existed ? `“${name}” is already in your list` : `Added “${name}”`, body.existed ? (sentence ? "This sentence was added to it." : "") : "Its entry is being written. Train it in the app.");
  } catch {
    notify("Not added", "The Learning app is not running at 127.0.0.1:4000.");
  }
});

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icon.png", title, message: message || " " });
}

// Runs in the page. The same rule as the app's own capture: the selection's paragraph (or list item,
// cell, quote), cut at the sentence ends either side of the selection.
function sentenceAround() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
  const range = sel.getRangeAt(0), word = range.toString().trim();
  const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const block = el?.closest("p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, dd, figcaption") ?? el;
  if (!block) return "";
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length, text = block.textContent ?? "";
  const ends = [...text.matchAll(/[.!?]["”’)]?\s+(?=["“‘(]?[A-Z0-9])/g)].map((m) => m.index + m[0].length);
  const from = Math.max(0, ...ends.filter((i) => i <= start));
  const to = ends.find((i) => i > start + word.length) ?? text.length;
  return text.slice(from, to).trim().replace(/\s+/g, " ").slice(0, 600);
}
