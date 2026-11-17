// Setup for a fresh clone of the engine: what is installed, the learning library, and starting the
// app with the computer. The /start-learning skill drives this; each step can also be run by hand.
//
//   bun run scripts/setup.ts check                         JSON: tools, library, autostart, app
//   bun run scripts/setup.ts library new [--github owner/name] [--public]
//   bun run scripts/setup.ts library clone <git url or owner/name>
//   bun run scripts/setup.ts autostart on|off|status
//   bun run scripts/setup.ts start                          start (or restart) the app now
//
// The library lives at ./library: its own git repo, ignored by the engine's. LEARNING_DIR points
// it elsewhere for the app, but the skills write to library/content/courses, so a library kept
// elsewhere needs ./library as a symlink to it.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const LIBRARY = resolve(process.env.LEARNING_DIR ?? join(ROOT, "library"));
const PORT = Number(process.env.PORT ?? 4000);
const LABEL = "learning";   // systemd unit learning.service; launchd com.learning.app

const run = (cmd: string, args: string[], cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};
const which = (cmd: string) => { const r = run("sh", ["-c", `command -v ${cmd}`]); return r.ok ? r.out.split("\n")[0] : null; };
const fail = (msg: string): never => { console.error(msg); process.exit(1); };
const say = (msg: string) => console.log(msg);

// --- check ------------------------------------------------------------------
function libraryState() {
  if (!existsSync(LIBRARY)) return { path: LIBRARY, exists: false, repo: false, remote: null as string | null, courses: 0 };
  const top = run("git", ["rev-parse", "--show-toplevel"], LIBRARY);
  const ownRepo = top.ok && realpathSync(top.out) === realpathSync(LIBRARY);
  const remote = ownRepo ? run("git", ["remote", "get-url", "origin"], LIBRARY) : null;
  const coursesDir = join(LIBRARY, "content/courses");
  const courses = existsSync(coursesDir) ? spawnSync("ls", [coursesDir], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).length : 0;
  return { path: LIBRARY, exists: true, repo: ownRepo, remote: remote?.ok ? remote.out : null, courses };
}
function autostartState() {
  const os = platform();
  if (os === "linux") {
    const file = join(homedir(), ".config/systemd/user", `${LABEL}.service`);
    const enabled = run("systemctl", ["--user", "is-enabled", `${LABEL}.service`]).out === "enabled";
    const active = run("systemctl", ["--user", "is-active", `${LABEL}.service`]).out === "active";
    return { supported: true, kind: "systemd", file, installed: existsSync(file), enabled, active };
  }
  if (os === "darwin") {
    const file = join(homedir(), "Library/LaunchAgents", `com.${LABEL}.app.plist`);
    const loaded = run("launchctl", ["list", `com.${LABEL}.app`]).ok;
    return { supported: true, kind: "launchd", file, installed: existsSync(file), enabled: existsSync(file), active: loaded };
  }
  return { supported: false, kind: null, file: null, installed: false, enabled: false, active: false };
}
async function appUp() {
  try { const r = await fetch(`http://localhost:${PORT}/api/sync`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}
async function check() {
  const gh = which("gh");
  const ghUser = gh ? run("gh", ["api", "user", "--jq", ".login"]) : null;
  const out = {
    engine: ROOT,
    platform: platform(),
    tools: {
      bun: which("bun"), git: which("git"), claude: which("claude"), gh,
      ghLoggedIn: !!ghUser?.ok, ghUser: ghUser?.ok ? ghUser.out : null,
      gitIdentity: !!run("git", ["config", "user.email"]).out,
    },
    dependencies: existsSync(join(ROOT, "node_modules")),
    library: libraryState(),
    autostart: autostartState(),
    app: { port: PORT, running: await appUp() },
  };
  console.log(JSON.stringify(out, null, 2));
}

// --- library ----------------------------------------------------------------
const LIBRARY_README = `# Learning library

Your data for the learning engine: courses, notes and progress. The engine keeps this repo checked out at \`library/\` inside its own folder, commits here as you work and pushes, so every machine you learn on stays in step.

\`\`\`
content/courses/<slug>/    courses the engine writes (Markdown)
content/folders.json       folders, including empty ones
content/folders/<path>.md  folder context, read by every course in the folder
notes/<course>/<module>.md your module notes
state/                     answers, review cards, highlights, chats (JSON, one file per record)
\`\`\`

Edit by hand only what you would edit in the app. The engine owns the format; see its \`CLAUDE.md\`.
`;
const LIBRARY_IGNORE = `# Sources a generation job downloads to read (transcription PDFs, page renders): working files, not course content, and not ours to redistribute.
content/courses/*/modules/*/research/sources/
*.tmp.*
.DS_Store
`;
function libraryNew(args: string[]) {
  const s = libraryState();
  if (s.exists && s.repo) fail(`A library already exists at ${LIBRARY}${s.remote ? ` (${s.remote})` : ""}. Nothing to do.`);
  if (s.exists && run("ls", ["-A", LIBRARY]).out) fail(`${LIBRARY} exists and is not empty, but is not its own git repo. Move it aside first.`);
  const gi = args.indexOf("--github"), repo = gi >= 0 ? args[gi + 1] : null, visibility = args.includes("--public") ? "--public" : "--private";
  if (gi >= 0 && !repo) fail("--github needs owner/name");
  for (const d of ["content/courses", "content/folders", "notes", "state"]) mkdirSync(join(LIBRARY, d), { recursive: true });
  for (const d of ["content/courses", "notes", "state"]) writeFileSync(join(LIBRARY, d, ".gitkeep"), "");
  writeFileSync(join(LIBRARY, "content/folders.json"), "[]\n");
  writeFileSync(join(LIBRARY, "README.md"), LIBRARY_README);
  writeFileSync(join(LIBRARY, ".gitignore"), LIBRARY_IGNORE);
  for (const [cmd, a] of [["git", ["init", "-q", "-b", "main"]], ["git", ["add", "-A"]], ["git", ["commit", "-q", "-m", "New learning library"]]] as const) {
    const r = run(cmd, [...a], LIBRARY); if (!r.ok) fail(`${cmd} ${a.join(" ")}: ${r.out}`);
  }
  say(`Library created at ${LIBRARY}.`);
  if (repo) {
    const r = run("gh", ["repo", "create", repo, visibility, "--source", LIBRARY, "--remote", "origin", "--push", "--description", "My learning library: courses, notes and progress"], LIBRARY);
    if (!r.ok) fail(`gh repo create ${repo}: ${r.out}\nThe library exists locally; add a remote later with: git -C ${LIBRARY} remote add origin <url> && git -C ${LIBRARY} push -u origin main`);
    say(`Created ${visibility.slice(2)} GitHub repo ${repo} and pushed. The app syncs to it from now on.`);
  } else say("No remote: the library stays on this machine until you add one.");
}
function libraryClone(args: string[]) {
  const src = args[0] ?? fail("library clone needs a git URL or owner/name");
  const s = libraryState();
  if (s.exists && run("ls", ["-A", LIBRARY]).out) fail(`${LIBRARY} already exists and is not empty.`);
  const url = /^[\w.-]+\/[\w.-]+$/.test(src) ? `git@github.com:${src}.git` : src;
  mkdirSync(dirname(LIBRARY), { recursive: true });
  let r = run("git", ["clone", "-q", url, LIBRARY]);
  if (!r.ok && /^[\w.-]+\/[\w.-]+$/.test(src) && which("gh")) r = run("gh", ["repo", "clone", src, LIBRARY, "--", "-q"]);
  if (!r.ok) fail(`clone ${url}: ${r.out}`);
  say(`Cloned ${src} into ${LIBRARY}: ${libraryState().courses} course(s).`);
}

// --- autostart ----------------------------------------------------------------
function systemdUnit() {
  const bun = which("bun") ?? fail("bun is not on PATH");
  const claude = which("claude");
  const path = [...new Set([claude && dirname(claude), dirname(bun), "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean))].join(":");
  return `[Unit]
Description=Learning (the course app at http://localhost:${PORT})
# Written by scripts/setup.ts autostart on. Logs: journalctl --user -u ${LABEL} -f
# After pulling engine changes: systemctl --user restart ${LABEL}
After=network-online.target

[Service]
Type=exec
WorkingDirectory=${ROOT}
ExecStart=${bun} run app/server.ts
# claude must resolve for generation and grading jobs. git push uses the ssh-agent socket,
# which systemd's user environment already carries.
Environment=PATH=${path}
Environment=PORT=${PORT}
${process.env.LEARNING_DIR ? `Environment=LEARNING_DIR=${LIBRARY}\n` : ""}# On stop the server cancels running jobs and pushes pending notes and chats (up to 8 s).
TimeoutStopSec=20
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}
function launchdPlist() {
  const bun = which("bun") ?? fail("bun is not on PATH");
  const claude = which("claude");
  const path = [...new Set([claude && dirname(claude), dirname(bun), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean))].join(":");
  const logs = join(homedir(), "Library/Logs/learning.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.${LABEL}.app</string>
  <key>ProgramArguments</key><array><string>${bun}</string><string>run</string><string>app/server.ts</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${path}</string>
    <key>PORT</key><string>${PORT}</string>${process.env.LEARNING_DIR ? `\n    <key>LEARNING_DIR</key><string>${LIBRARY}</string>` : ""}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${logs}</string>
  <key>StandardErrorPath</key><string>${logs}</string>
</dict>
</plist>
`;
}
function autostart(mode: string) {
  const st = autostartState();
  if (mode === "status") return console.log(JSON.stringify(st, null, 2));
  if (!st.supported) fail(`Starting with the computer is set up for Linux (systemd) and macOS (launchd) only. On ${platform()}, run \`bun run dev\` in this folder when you want the app.`);
  const file = st.file!;
  // A link left by an older setup (to scripts/learning.service) is replaced by a real file.
  const clear = () => { try { if (lstatSync(file)) rmSync(file); } catch {} };
  if (st.kind === "systemd") {
    if (mode === "on") {
      mkdirSync(dirname(file), { recursive: true }); clear(); writeFileSync(file, systemdUnit());
      run("systemctl", ["--user", "daemon-reload"]);
      const r = run("systemctl", ["--user", "enable", "--now", `${LABEL}.service`]);
      if (!r.ok) fail(`systemctl enable: ${r.out}`);
      run("systemctl", ["--user", "restart", `${LABEL}.service`]);
      say(`The app now starts when you log in, and is running at http://localhost:${PORT}.`);
    } else if (mode === "off") {
      run("systemctl", ["--user", "disable", "--now", `${LABEL}.service`]); clear(); run("systemctl", ["--user", "daemon-reload"]);
      say("The app no longer starts with the computer, and is stopped.");
    } else fail("autostart on|off|status");
  } else {
    if (mode === "on") {
      mkdirSync(dirname(file), { recursive: true });
      run("launchctl", ["unload", file]); clear(); writeFileSync(file, launchdPlist());
      const r = run("launchctl", ["load", "-w", file]);
      if (!r.ok) fail(`launchctl load: ${r.out}`);
      say(`The app now starts when you log in, and is running at http://localhost:${PORT}.`);
    } else if (mode === "off") {
      run("launchctl", ["unload", "-w", file]); clear();
      say("The app no longer starts with the computer, and is stopped.");
    } else fail("autostart on|off|status");
  }
}

// --- start --------------------------------------------------------------------
async function start() {
  const st = autostartState();
  if (st.enabled && st.kind === "systemd") { run("systemctl", ["--user", "restart", `${LABEL}.service`]); }
  else if (st.enabled && st.kind === "launchd") { run("launchctl", ["kickstart", "-k", `gui/${process.getuid?.()}/com.${LABEL}.app`]); }
  else if (!(await appUp())) {
    // No service: run detached, logging to data/app.log, so it outlives this command.
    mkdirSync(join(ROOT, "data"), { recursive: true });
    const r = run("sh", ["-c", `nohup bun run app/server.ts >> data/app.log 2>&1 &`]);
    if (!r.ok) fail(r.out);
  }
  for (let i = 0; i < 20 && !(await appUp()); i++) await Bun.sleep(500);
  if (!(await appUp())) fail(`The app did not come up on port ${PORT}. See ${st.enabled ? (st.kind === "systemd" ? `journalctl --user -u ${LABEL}` : "~/Library/Logs/learning.log") : "data/app.log"}.`);
  say(`Running at http://localhost:${PORT}.`);
}

// --- main -------------------------------------------------------------------
const [cmd, sub, ...rest] = process.argv.slice(2);
if (cmd === "check") await check();
else if (cmd === "library" && sub === "new") libraryNew(rest);
else if (cmd === "library" && sub === "clone") libraryClone(rest);
else if (cmd === "autostart") autostart(sub ?? "status");
else if (cmd === "start") await start();
else fail("usage: bun run scripts/setup.ts check | library new [--github owner/name] [--public] | library clone <url|owner/name> | autostart on|off|status | start");
