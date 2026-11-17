// The courses page as a column browser, after the Finder's column view: folders nest in columns,
// courses sit in them, and the inspector on the right describes what is selected and has Go.
// Courses drag into and out of folders (dnd-kit: the dragged row is the real row, drawn in an
// overlay, not a browser snapshot). New folders and moves show at once (optimistic) and are
// saved behind; the server's next list confirms them. The selection lives in the URL (?sel=…).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { del, get, post, put, type Course } from "./api";
import { Editor } from "./Editor";
import { Link, navigate } from "./App";

type Kind = "folder" | "course";
type Item = { key: string; kind: Kind; label: string; sub?: string; children?: Item[]; course?: Course; folder?: string };

// --- the tree -------------------------------------------------------------
function courseStatus(c: Course) {
  if (c.format === "brief") return c.modules[0]?.status === "ready" ? (c.progress?.done ? "Brief · done" : "Brief") : "Brief · writing";
  if (c.stage === "baseline") return "Baseline waiting";
  if (c.stage === "assessed") return "Outline pending";
  const done = c.progress?.done ?? 0, n = c.modules.length;
  return done === n ? `All ${n} modules done` : `${done} of ${n} modules done`;
}
const courseItem = (c: Course): Item => ({ key: `c:${c.slug}`, kind: "course", label: c.title, sub: courseStatus(c), course: c });

// Folders nest by path ("Work/Clients"); each level lists its folders first, then its courses.
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
function levelItems(parent: string | null, courses: Course[], folders: string[]): Item[] {
  const depth = parent ? parent.split("/").length : 0;
  const subs = folders.filter((f) => f.split("/").length === depth + 1 && (!parent || f.startsWith(parent + "/")));
  const here = courses.filter((c) => (c.folder ?? null) === parent).sort((a, b) => a.title.localeCompare(b.title));
  return [
    ...subs.sort((a, b) => a.localeCompare(b)).map((f): Item => {
      const children = levelItems(f, courses, folders);
      const nf = children.filter((i) => i.kind === "folder").length, nc = children.length - nf;
      return { key: `f:${f}`, kind: "folder", label: f.split("/").at(-1)!, folder: f, children,
        sub: children.length ? [nf && plural(nf, "folder"), nc && plural(nc, "course")].filter(Boolean).join(", ") : "Empty" };
    }),
    ...here.map(courseItem),
  ];
}
const folderKeys = (path: string | null) => (path ? path.split("/").map((_, i, a) => `f:${a.slice(0, i + 1).join("/")}`) : []);
const ancestors = (path: string) => path.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"));

// The selection as a list of keys, one per column, resolved against the tree. Keys that no longer
// resolve cut the path there.
function resolvePath(root: Item[], keys: string[]): Item[] {
  const out: Item[] = [];
  let level: Item[] | undefined = root;
  for (const k of keys) {
    const hit: Item | undefined = level?.find((i) => i.key === k);
    if (!hit) break;
    out.push(hit); level = hit.children;
  }
  return out;
}
const readSel = () => (new URLSearchParams(location.search).get("sel") ?? "").split("|").filter(Boolean);
function writeSel(keys: string[]) {
  const u = new URL(location.href);
  keys.length ? u.searchParams.set("sel", keys.join("|")) : u.searchParams.delete("sel");
  history.replaceState(null, "", u.pathname + u.search);
}

// Where Go leads: where the course picks up, or its baseline, or its outline.
function goOf(it: Item): string | null {
  const c = it.course;
  if (it.kind !== "course" || !c) return null;
  const r = c.progress?.resume;
  if (r) return `/c/${c.slug}/m/${r.module}/${r.file}`;
  if (c.stage === "baseline" && c.format !== "brief") return `/c/${c.slug}/baseline`;
  return `/c/${c.slug}`;
}

// --- icons ---------------------------------------------------------------
const ICON: Record<Kind, ReactNode> = {
  folder: <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.4l1.6 1.6H13A1.5 1.5 0 0 1 14.5 6.1v5.4A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5z" />,
  course: <path d="M3 2.5h7.5A2.5 2.5 0 0 1 13 5v8.5H5A2 2 0 0 1 3 11.5zM3 11.5A2 2 0 0 1 5 9.5h8" fill="none" strokeWidth="1.3" stroke="currentColor" />,
};
const Icon = ({ kind }: { kind: Kind }) => <svg className={`fi fi-${kind}`} viewBox="0 0 16 16" aria-hidden="true">{ICON[kind]}</svg>;

// --- rows and columns -------------------------------------------------------
// One row, drawn the same in its column and under the pointer while dragged (DragOverlay), so the
// thing you drag is the thing you clicked.
type RowState = { selected?: boolean; current?: boolean; drop?: boolean; ghost?: boolean; overlay?: boolean };
const rowClass = (r: RowState) => `fc-item${r.selected ? " is-selected" : ""}${r.current ? " is-current" : ""}${r.drop ? " is-drop" : ""}${r.ghost ? " is-dragged" : ""}${r.overlay ? " is-overlay" : ""}`;
function RowBody({ it }: { it: Item }) {
  return (
    <>
      <Icon kind={it.kind} />
      <span className="fc-label">
        <span className="fc-title">{it.label}</span>
        {it.sub && <span className="fc-sub">{it.sub}</span>}
      </span>
      {it.children && <svg className="fc-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>}
    </>
  );
}
type RowProps = { it: Item; depth: number; state: RowState; onSelect: () => void; onGo: () => void };
// A course row is draggable; a folder row takes drops. Both select on press, as in the Finder.
function Row({ it, depth, state, onSelect, onGo }: RowProps) {
  const drag = useDraggable({ id: it.key, data: { slug: it.course?.slug, item: it }, disabled: it.kind !== "course" });
  const drop = useDroppable({ id: it.key, data: { to: it.folder, item: it, depth }, disabled: it.kind !== "folder" });
  const ref = (el: HTMLButtonElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  return (
    <button type="button" ref={ref} {...drag.attributes} {...drag.listeners} role="option" aria-selected={!!state.selected} tabIndex={-1}
      className={rowClass({ ...state, ghost: drag.isDragging })}
      onMouseDown={(e) => { if (e.button === 0) onSelect(); }} onClick={onSelect} onDoubleClick={onGo}>
      <RowBody it={it} />
    </button>
  );
}
// A column's list takes drops on its empty space: the course goes into the column's folder.
function ColumnList({ depth, to, drop, label, children }: { depth: number; to: string | null; drop: boolean; label: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `col:${depth}`, data: { to, depth } });
  return <div ref={setNodeRef} className={`fc-list${drop ? " is-drop" : ""}`} role="listbox" aria-label={label}>{children}</div>;
}
// Rows sit inside columns, so the pointer is often within both: the row (a folder) wins.
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 1 ? [...hits.filter((h) => String(h.id).startsWith("f:")), ...hits.filter((h) => !String(h.id).startsWith("f:"))] : hits;
};

// --- the browser ----------------------------------------------------------
const SPRING_MS = 650;   // hovering a dragged course over a folder this long opens it

export function Browser({ courses, folders, onNewCourse }: { courses: Course[]; folders: string[]; onNewCourse: (folder: string | null) => void }) {
  // Optimistic state, dropped piece by piece as the server's lists catch up.
  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const [moves, setMoves] = useState<Record<string, string | null>>({});
  useEffect(() => { setPendingFolders((p) => p.filter((f) => !folders.includes(f))); }, [folders]);
  useEffect(() => {
    setMoves((m) => {
      const left = Object.fromEntries(Object.entries(m).filter(([slug, to]) => courses.find((c) => c.slug === slug)?.folder !== to));
      return Object.keys(left).length === Object.keys(m).length ? m : left;
    });
  }, [courses]);
  const shown = useMemo(() => courses.map((c) => (c.slug in moves ? { ...c, folder: moves[c.slug] } : c)), [courses, moves]);
  const root = useMemo(() => {
    const all = new Set<string>();
    for (const f of [...folders, ...pendingFolders]) ancestors(f).forEach((a) => all.add(a));
    for (const c of shown) if (c.folder) ancestors(c.folder).forEach((a) => all.add(a));
    return levelItems(null, shown, [...all]);
  }, [shown, folders, pendingFolders]);

  const [keys, setKeys] = useState<string[]>(readSel);
  const path = resolvePath(root, keys);
  const selected = path.at(-1) ?? null;
  // Columns: the root, then the children of each selected folder.
  const columns: Item[][] = [root, ...path.map((p) => p.children).filter((c): c is Item[] => !!c)];
  const wrap = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const setPath = (k: string[]) => { setKeys(k); writeSel(k); };
  const select = (depth: number, it: Item) => {
    const next = [...path.slice(0, depth).map((p) => p.key), it.key];
    if (next.join("|") !== path.map((p) => p.key).join("|")) setPath(next);
  };
  // The folder a column lists: the root (null), or the folder selected to its left.
  const folderOf = (depth: number): string | null => (depth === 0 ? null : path[depth - 1]?.folder ?? null);

  // "+ New": the column whose menu is open, and the column naming a new folder.
  const [menu, setMenu] = useState<number | null>(null);
  const [naming, setNaming] = useState<number | null>(null);
  useEffect(() => {
    if (menu === null) return;
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.(".fc-foot")) setMenu(null); };
    addEventListener("pointerdown", close, true); return () => removeEventListener("pointerdown", close, true);
  }, [menu]);
  // Right-click in a column: a menu at the pointer for that column's folder.
  const [ctx, setCtx] = useState<{ x: number; y: number; depth: number } | null>(null);
  const onColumnContext = (depth: number) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return;   // keep the native menu for text
    e.preventDefault();
    setMenu(null);
    setCtx({ x: e.clientX, y: e.clientY, depth });
  };
  const makeFolder = (depth: number, name: string) => {
    const parent = folderOf(depth), full = parent ? `${parent}/${name}` : name;
    setNaming(null);
    setPendingFolders((p) => [...p, full]);
    setPath(folderKeys(full));
    post("/api/folders", { path: full }).catch(() => setPendingFolders((p) => p.filter((f) => f !== full)));
  };

  // Drag a course onto a folder, or onto a column's empty space, to file it there. A few pixels
  // of movement start a drag, so a click still only selects.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragged, setDragged] = useState<{ item: Item; state: RowState } | null>(null);
  const [over, setOver] = useState<string | null>(null);   // "f:<path>" or "col:<depth>"
  const spring = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearSpring = () => { if (spring.current) clearTimeout(spring.current.timer); spring.current = null; };
  const move = (slug: string, to: string | null) => {
    const c = shown.find((x) => x.slug === slug);
    if (!c || (c.folder ?? null) === to) return;
    setMoves((m) => ({ ...m, [slug]: to }));
    if (selected?.course?.slug === slug) setPath([...folderKeys(to), `c:${slug}`]);
    put(`/api/courses/${slug}/meta`, { folder: to ?? "" }).catch(() => setMoves((m) => { const { [slug]: _, ...rest } = m; return rest; }));
  };
  const onDragStart = (e: DragStartEvent) => {
    const item = e.active.data.current?.item as Item;
    const on = selected?.key === item.key;
    setDragged({ item, state: { selected: on, current: on } });
  };
  const onDragOver = (e: DragOverEvent) => {
    const id = e.over ? String(e.over.id) : null;
    setOver(id);
    // Spring-loaded folders: hover to open, as in the Finder.
    if (spring.current?.id === id) return;
    clearSpring();
    const data = e.over?.data.current as { item?: Item; depth: number } | undefined;
    if (id?.startsWith("f:") && data?.item) { const { item, depth } = data; spring.current = { id, timer: setTimeout(() => select(depth, item), SPRING_MS) }; }
  };
  const onDragEnd = (e: DragEndEvent) => {
    clearSpring(); setOver(null); setDragged(null);
    const slug = e.active.data.current?.slug as string | undefined, to = e.over?.data.current?.to as string | null | undefined;
    if (slug && e.over && to !== undefined) move(slug, to);
  };
  const onDragCancel = () => { clearSpring(); setOver(null); setDragged(null); };

  // Keep the newest column in view only when it is cut off, so a click on a wide screen never moves anything.
  useEffect(() => {
    const el = cols.current, last = el?.querySelectorAll<HTMLElement>(".fc-col")[columns.length - 1];
    if (el && last && last.offsetLeft + last.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = last.offsetLeft + last.offsetWidth - el.clientWidth;
  }, [columns.length]);
  // The current item stays in view inside its column.
  useEffect(() => {
    const it = wrap.current?.querySelector<HTMLElement>(".fc-list .fc-item.is-current"), col = it?.closest<HTMLElement>(".fc-list");
    if (!it || !col) return;
    if (it.offsetTop < col.scrollTop) col.scrollTop = it.offsetTop - 4;
    else if (it.offsetTop + it.offsetHeight > col.scrollTop + col.clientHeight) col.scrollTop = it.offsetTop + it.offsetHeight - col.clientHeight + 4;
  }, [keys.join("|")]);

  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable=true]") || t.isContentEditable) return;
    if (e.key === "Escape" && menu !== null) { setMenu(null); return; }
    const depth = Math.max(0, path.length - 1), list = columns[depth] ?? root;
    const i = selected ? list.findIndex((x) => x.key === selected.key) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!selected) { if (root[0]) select(0, root[0]); return; }
      const n = list[Math.min(list.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (n) select(depth, n);
    } else if (e.key === "ArrowRight" && selected?.children?.[0]) { e.preventDefault(); select(path.length, selected.children[0]); }
    else if (e.key === "ArrowLeft" && path.length > 1) { e.preventDefault(); setPath(path.slice(0, -1).map((p) => p.key)); }
    else if (e.key === "Enter" && selected) { const g = goOf(selected); if (g) { e.preventDefault(); navigate(g); } }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className={`finder${dragged ? " is-dragging" : ""}`} ref={wrap} tabIndex={0} onKeyDown={onKey} aria-label="Courses, by folder">
        <div className="fc-cols" ref={cols}>
          {columns.map((list, depth) => (
            <div className="fc-col" key={depth} onContextMenu={onColumnContext(depth)}>
              <ColumnList depth={depth} to={folderOf(depth)} drop={over === `col:${depth}`} label={depth === 0 ? "Library" : path[depth - 1]?.label ?? ""}>
                {list.length === 0 && naming !== depth && <p className="fc-empty muted">{dragged ? "Drop here" : "Empty"}</p>}
                {list.map((it) => {
                  const on = path[depth]?.key === it.key;
                  return (
                    <Row key={it.key} it={it} depth={depth}
                      state={{ selected: on, current: on && depth === path.length - 1, drop: over === it.key }}
                      onSelect={() => select(depth, it)} onGo={() => { const g = goOf(it); if (g) navigate(g); }} />
                  );
                })}
                {naming === depth && <NewFolderRow taken={list.filter((i) => i.kind === "folder").map((i) => i.label)} onDone={(name) => (name ? makeFolder(depth, name) : setNaming(null))} />}
              </ColumnList>
              <div className="fc-foot">
                {menu === depth && (
                  <div className="fc-menu" role="menu" onMouseDown={(e) => e.preventDefault()}>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); setNaming(depth); }}><Icon kind="folder" /> New folder</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); onNewCourse(folderOf(depth)); }}><Icon kind="course" /> New course…</button>
                  </div>
                )}
                <button type="button" className="fc-new" aria-haspopup="menu" aria-expanded={menu === depth} onClick={() => setMenu(menu === depth ? null : depth)}>
                  <span aria-hidden="true">+</span> New{depth > 0 && <span className="fc-new-in">in {path[depth - 1].label}</span>}
                </button>
              </div>
            </div>
          ))}
          <div className="fc-spacer" />
        </div>
        <Inspector item={selected} onFolderMoved={(to) => setPath(folderKeys(to))} />
      </div>
      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)}
          title={folderOf(ctx.depth) ? `In ${folderOf(ctx.depth)!.split("/").join(" › ")}` : "In Library"}
          items={[
            { label: "New Folder", icon: "folder", run: () => setNaming(ctx.depth) },
            { label: "New Course…", icon: "course", run: () => onNewCourse(folderOf(ctx.depth)) },
          ]} />
      )}
      {/* The row itself follows the pointer; no drop animation, since a drop moves the row anyway. */}
      <DragOverlay dropAnimation={null}>
        {dragged && <div className={rowClass({ ...dragged.state, overlay: true })}><RowBody it={dragged.item} /></div>}
      </DragOverlay>
    </DndContext>
  );
}

// A context menu at the pointer, kept inside the window. Closes on a click elsewhere, Escape,
// scroll, resize or the window losing focus; arrow keys move between items and Enter runs one.
function ContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title?: string; items: { label: string; icon: Kind; run: () => void }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const { width, height } = el.getBoundingClientRect(), pad = 8;
    setPos({ left: Math.max(pad, Math.min(x, innerWidth - width - pad)), top: Math.max(pad, Math.min(y, innerHeight - height - pad)) });
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const close = () => onClose();
    addEventListener("pointerdown", down, true); addEventListener("scroll", close, true); addEventListener("resize", close); addEventListener("blur", close);
    return () => { removeEventListener("pointerdown", down, true); removeEventListener("scroll", close, true); removeEventListener("resize", close); removeEventListener("blur", close); };
  }, [onClose]);
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])], i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); btns[(i + (e.key === "ArrowDown" ? 1 : btns.length - 1)) % btns.length]?.focus(); }
    else if (e.key === "Tab") e.preventDefault();
  };
  return (
    <div ref={ref} className="fc-context" role="menu" style={pos} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {title && <div className="fc-context-title">{title}</div>}
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" onClick={() => { onClose(); it.run(); }}><Icon kind={it.icon} /> {it.label}</button>
      ))}
    </div>
  );
}

// The editable row a new folder starts as, like the Finder's "untitled folder".
function NewFolderRow({ taken, onDone }: { taken: string[]; onDone: (name: string | null) => void }) {
  const base = "untitled folder";
  const first = taken.includes(base) ? Array.from({ length: 99 }, (_, i) => `${base} ${i + 2}`).find((n) => !taken.includes(n))! : base;
  const [name, setName] = useState(first);
  const done = useRef(false);
  const finish = (v: string | null) => { if (done.current) return; done.current = true; onDone(v); };
  const clean = name.replace(/[|/]/g, "").trim();
  return (
    <div className="fc-item fc-naming">
      <Icon kind="folder" />
      <input autoFocus value={name} aria-label="Folder name" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(clean && !taken.includes(clean) ? clean : null); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } }}
        onBlur={() => finish(clean && !taken.includes(clean) ? clean : null)} />
    </div>
  );
}

// --- the inspector --------------------------------------------------------
function Inspector({ item, onFolderMoved }: { item: Item | null; onFolderMoved: (path: string | null) => void }) {
  if (!item) return (
    <aside className="fc-inspector is-empty"><p className="muted">Select a folder or course to see what is in it. Drag a course onto a folder to file it.</p></aside>
  );
  const go = goOf(item);
  const c = item.course;
  return (
    <aside className="fc-inspector" aria-label="Inspector">
      <div className="fi-body">
        <div className="fi-head">
          <Icon kind={item.kind} />
          <span className="fi-kind">{item.kind === "course" && c?.format === "brief" ? "Brief" : item.kind}</span>
        </div>
        <h2 className="fi-title">{item.label}</h2>
        {item.kind === "folder" && <FolderInfo item={item} onMoved={onFolderMoved} />}
        {item.kind === "course" && c && (
          <>
            {c.description && <p className="fi-desc">{c.description}</p>}
            <dl className="fi-meta">
              <dt>Progress</dt><dd>{courseStatus(c)}</dd>
              {c.depth && c.format !== "brief" && <><dt>Depth</dt><dd>{c.depth}</dd></>}
              <dt>Modules</dt><dd>{c.modules.length || "none yet"}</dd>
              {c.progress?.resume && <><dt>Next</dt><dd>{c.progress.resume.moduleTitle} · {c.progress.resume.title}</dd></>}
              {c.progress?.nextToGenerate && <><dt>Next</dt><dd>Module {c.progress.nextToGenerate.slice(0, 2)} is not generated yet</dd></>}
              <dt>Daily review</dt><dd>{c.review ? "included" : "left out"}</dd>
            </dl>
          </>
        )}
      </div>
      {go && <div className="fi-foot"><Link to={go} className="btn primary fi-go">Go →</Link></div>}
    </aside>
  );
}

// A folder's context: a markdown note every course in the folder, at any depth, reads when content
// is generated for it. Saves as you type, like module notes.
function FolderContext({ path }: { path: string }) {
  const [initial, setInitial] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<string | null>(null);
  const save = (md: string) => {
    setStatus("saving");
    put("/api/folders/context", { path, markdown: md }).then(() => { if (latest.current === md) setStatus("saved"); }, () => setStatus("error"));
  };
  useEffect(() => { get<{ markdown: string }>(`/api/folders/context?path=${encodeURIComponent(path)}`).then((r) => setInitial(r.markdown), () => setInitial("")); }, [path]);
  // Leaving the folder with a save pending: send it now.
  useEffect(() => () => { if (latest.current !== null && timer.current) { clearTimeout(timer.current); put("/api/folders/context", { path, markdown: latest.current }); } }, [path]);
  const depth = path.split("/").length;
  return (
    <section className="fi-context">
      <div className="fi-context-head">
        <h3 className="fi-sub">Context</h3>
        <span className="muted fi-context-status">{status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved" : status === "error" ? "Not saved" : initial ? "Saved" : ""}</span>
      </div>
      <p className="muted fi-note">Every course in this folder{depth ? " and its subfolders" : ""} reads this when its content is written{depth > 1 ? ", after the context of the folders above" : ""}.</p>
      <Editor value={initial} className="fi-context-editor"
        placeholder="Who this is for, what you are working on, the product, the terms your team uses, what to emphasize or avoid…"
        onChange={(md) => { latest.current = md; setStatus("unsaved"); clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = undefined; save(md); }, 600); }} />
    </section>
  );
}

// A folder: what is in it, a rename that carries every course and subfolder along, and delete
// while it is empty.
function FolderInfo({ item, onMoved }: { item: Item; onMoved: (path: string | null) => void }) {
  const path = item.folder!, parent = path.split("/").slice(0, -1).join("/");
  const [name, setName] = useState(item.label);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setName(item.label); setErr(null); }, [path]);
  const all: Course[] = [];
  const walk = (its: Item[] = []) => its.forEach((i) => (i.kind === "course" ? all.push(i.course!) : walk(i.children)));
  walk(item.children);
  const clean = name.replace(/[|/]/g, "").trim();
  const rename = async () => {
    if (!clean || clean === item.label) return;
    const to = parent ? `${parent}/${clean}` : clean;
    setBusy(true); setErr(null);
    try { await put("/api/folders", { from: path, to }); onMoved(to); } catch { setErr("Could not rename: is that name taken?"); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try { await del(`/api/folders?path=${encodeURIComponent(path)}`); onMoved(parent || null); } catch { setErr("Only an empty folder can be deleted."); }
    setBusy(false);
  };
  return (
    <>
      {parent && <p className="fi-crumb muted">{parent.split("/").join(" › ")}</p>}
      <FolderContext key={path} path={path} />
      <dl className="fi-meta">
        <dt>Courses</dt><dd>{all.length}{all.length !== (item.children ?? []).filter((i) => i.kind === "course").length ? " (in subfolders too)" : ""}</dd>
        {all.length > 0 && <><dt>Daily review</dt><dd>{all.filter((c) => c.review).length} of {all.length} included</dd></>}
      </dl>
      <form className="fi-rename" onSubmit={(e) => { e.preventDefault(); rename(); }}>
        <label>Rename <input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button type="submit" disabled={busy || !clean || clean === item.label}>{busy ? "Saving…" : "Rename"}</button>
      </form>
      {all.length === 0 && <p><button type="button" onClick={remove} disabled={busy}>Delete folder</button></p>}
      {err && <p className="fi-note" style={{ color: "var(--bad)" }}>{err}</p>}
    </>
  );
}
