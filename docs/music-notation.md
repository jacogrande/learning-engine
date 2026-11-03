# Music notation and recorded passages in the reader

Date: 2026-11-02. The reader can now engrave staff notation from a fenced block, play it, and embed a player for one cited passage of a YouTube recording. This note records how each piece works, the decisions behind it, and the workflow used to transcribe a phrase from a record. The demo course that exercised all of it (`music-notation-demo`) has been deleted. Its three ABC blocks and the video directive are reproduced at the end; the complete course (sections, the 11 quiz items, every source link) is in git history: `git show 4c7b494^:library/content/courses/music-notation-demo/…`.

*Updated 2026-11-02 after a code review of `4c7b494`: the sections below describe the code as fixed, not as first committed.*

*Updated 2026-11-03: generation now follows this workflow. `.claude/skills/transcribe/SKILL.md` is the transcription procedure (published transcription, notes read off the page and checked against the harmony, timestamp from two sources, guitar parts in `clef=treble-8`); `module-researcher` follows it for each objective's strongest recorded example, and `generate-module` has a Music section (every line as a score, at least half the sections on a real recording, standards in their usual keys). `scripts/check-notation.ts` runs the lint's notation checks on any file and confirms each video through YouTube's oEmbed endpoint. Module and lesson jobs may run `curl`, `pdftoppm`, `uv run`, `mkdir` and that script.*

## What course authors write

Two additions to the content grammar (`.claude/rules/content-grammar.md`), both plain Markdown, no HTML:

````markdown
```abc
X:1
T:ii-V-I in C
M:4/4
L:1/8
Q:1/4=140
K:C
"Dm7" DFAc dcAF | "G7" _AGFE DB,G,F, | "Cmaj7" E4 z4 |]
```

::youtube{v="-_lIEU7mz8s" t="1:43" end="1:49" title="Stan Getz, Pennies from Heaven, 1957"}
````

| Block | What the reader sees |
|---|---|
| `abc` fence | An engraved staff with chord symbols, and a transport bar beneath it: restart, play/pause, progress, clock, tempo percent. Notes light up as they sound. |
| `::youtube` directive | A video frame with YouTube's own controls hidden, and a bar beneath it: play/pause, Reset, a scrubber bounded by the passage, a clock in video time, and a speed menu. A caption links to the same moment on YouTube. |

Rules that matter for authors:

- Always set `M:`, `L:`, `K:` and `Q:`. `Q:` is what the player uses for tempo.
- Chord symbols go in double quotes before the note they sit on. abcjs reads them and lays a comping track under the line, so they are not decoration.
- A space between notes breaks the beam. Write the eighths of one beat group without spaces (`GCD^D`) and keep the space only between groups. Spacing every note renders every eighth as a loose flagged note.
- Write concert pitch. A phrase from a recording names the source and timestamp in the prose, never only in the block.
- Use `::youtube` only for a recording the section quotes, placed right after the prose that cites the moment. `t` and `end` take `m:ss` or seconds; `end` may carry a decimal (`1:48.5`). Without `end`, the passage runs to the end of the video.

## Why ABC

The question was whether anything like Mermaid exists for staff notation. The candidates were ABC (abcjs), LilyPond, MusicXML, VexFlow and VexTab. ABC won on four counts: it is a text format a model can write directly from a book or a blog transcription, the way it writes Mermaid; abcjs renders it in the browser with no server step; abcjs also synthesizes audio from the same source, so a player comes free; and the notation is compact enough to sit readably inside a Markdown file. LilyPond needs a native binary. MusicXML is too verbose to author by hand. VexFlow is a drawing API, not a notation.

## How the `abc` fence renders

All in `app/client/Markdown.tsx`. The `Fence` component already dispatched `mermaid` and `quiz` fences by language; `abc` is one more line there, routed to an `Abc` component.

1. **Loading.** abcjs is about a megabyte, and Bun's dev bundler inlined the dynamic import into the app bundle. The server now serves abcjs's prebuilt `abcjs-basic-min.js` at `/vendor/abcjs.js`; the first score on a page adds that script once and uses `window.ABCJS`. A course with no music never fetches it, and a failed fetch lets the next block retry.
2. **Source.** One tune per fence: a second `X:` line is an error card, since abcjs would engrave only the first. Blank lines inside the fence are dropped, because in ABC a blank line ends the tune and abcjs would silently lose every line after it. An empty fence is an error card.
3. **Engraving.** `renderAbc` is called with `responsive: "resize"` so the SVG fits the reading column, `add_classes: true` so each note is an addressable element, `foregroundColor: "currentColor"` so the score follows the theme, `selectTypes: false` so a click never leaves a note lit like the one playing, and zero padding so the figure aligns with the prose. A tune with no lines, or a thrown parse error, becomes a `block-error` card showing the source. The card clears itself when the source becomes valid (a chat reply streaming in, a section rewritten while open).
4. **Problems.** abcjs engraves and plays malformed ABC without complaint: its warnings go to the console, and it never checks bar length, so an unquoted chord name (`G7 DFAc`) reads as a seven-eighths G with no warning at all. `app/shared/notation.ts` lists every parser warning and every bar that does not fill the meter (a short first bar is a pickup, a short last bar its complement), shown under the score and reported by the module lint.
5. **Audio.** If the browser has an AudioContext (checked directly: abcjs's `supportsAudio()` creates one as a side effect), a `SynthController` is loaded into a sibling div with `displayPlay`, `displayProgress`, `displayRestart`, `displayLoop` and `displayWarp` on. `setTune(tune, false)` prepares the audio lazily; the soundfont streams from abcjs's default CDN on the first press of play. The cursor-control callbacks add an `is-playing` class to the elements of the sounding note and clear it on the next event or at the end, which is what lights notes in the accent colour. A failed soundfont download used to leave the play button spinning for good; the controller's `play` is wrapped so a failure resets it and says so, and the next press retries. Starting a score pauses any other score or passage on the page. `%%MIDI swing N` sets the starting swing (abcjs parses it but never plays it, so the value is read from the source and passed as the synth's `swing` option); a selector beside the player changes it in x/4 and x/8 meters.
6. **Cleanup.** The effect calls `destroy()` on the controller, not `pause()`: pause does nothing while the first play is still fetching its sounds, and that play then started after the block was gone, looping for good with Loop on.

Styling: abcjs expects its own stylesheet for the transport bar. Instead, `styles.css` restyles `.abcjs-inline-audio` with the app's tokens (buttons, pushed state, progress bar, clock, tempo input) and hides the `.abcjs-css-warning` badge abcjs shows when it does not detect its stylesheet. abcjs's controls are `<button>`s, so the app's global button sizing is reset on them, and the loading circle gets a stroke (it has none of its own). Players keep the interface font whatever the reading font is.

## How the `::youtube` directive renders

### Parsing

The app already uses remark-directive, and a plugin maps container (`:::`) and leaf (`::`) directives to a `div` with `data-directive` and the attributes as props. The `div` component then dispatches on the directive name; `youtube` goes to a `YouTube` component, everything else stays a callout.

One parsing fix was needed. remark-directive also treats inline `:name` as a text directive, which swallowed ordinary prose such as "at 1:43" (the `:43` became a directive and vanished). Converting the node back to text lost labels, attributes and footnote references, so the app no longer uses remark-directive: it registers only the block constructs (container and leaf) from `micromark-extension-directive`, and inline colons stay plain text. A `:::youtube` written by mistake (the container form, which takes in everything after it) renders the player followed by that content, never hiding it; the lint flags it.

### The player

The first version was a plain `<iframe>` with `?start=`. The request for a player that plays only the passage, keeps speed control and has a reset button needed the YouTube IFrame Player API, which is the only supported way to seek, pause, read the current time and set the rate from the page.

- **Nothing loads until the first press.** The nocookie host does not cover the API script: `https://www.youtube.com/iframe_api` itself sets YouTube's long-lived cookies (`VISITOR_INFO1_LIVE`, `YSC` and others), and the nocookie domain has no API script. So the frame shows only the poster from `i.ytimg.com` (no cookies) and a play button; the script loads on the first Play, Reset or slider move, and that press is carried out once the player is ready.
- **Loading the API.** Injected once per page behind a module-level promise that chains any existing `onYouTubeIframeAPIReady`. A network error or 15 s of silence rejects it, clears the cache so the next press retries, and shows an error with Try again.
- **Creating the player.** `new YT.Player(el, …)` with `host` set to the nocookie domain. Player vars: `start` rounded down (YouTube drops a fractional start and plays from 0:00; the exact start is sought once ready), `controls: 0`, `rel: 0`, `fs: 0`, `disablekb: 1`, `iv_load_policy: 3`, `playsinline: 1`, and `origin`. No `end`: the app keeps it, and YouTube's own flashed a black frame and the replay icon at every passage end. `onError` (removed, private, embedding off) replaces the bar with the reason and a link to watch on YouTube.
- **Keeping the bounds.** YouTube honours `end` only until the first seek anyway. The component polls `getCurrentTime()` every 50 ms and, a hair before `end`, pauses and seeks back to `t`. Without `end`, the video's duration is read again until YouTube reports it. The player is keyed by `v`, `t` and `end`, so an edit to the passage while it is open builds a fresh one.
- **Controls.** Play/pause calls `playVideo` or `pauseVideo`; the icon follows `onStateChange`, and buffering counts as playing so the button can pause it. Reset seeks to `t` and plays. The position slider is a native range input, so arrow keys, Home and End seek; a move while paused seeks muted and pauses again (YouTube starts playback on any seek). Starting a passage pauses any other passage or score on the page. The speed menu is filled from `getAvailablePlaybackRates()` once the player is ready, so it offers exactly what YouTube offers for that video, and `setPlaybackRate` applies the choice. Buttons are disabled and the bar dimmed until `onReady`.
- **Clock.** Shows absolute video time, `1:45 / 1:49`, so it reads against the timestamp cited in the prose rather than a passage-relative count.
- **Cleanup.** The effect clears the poll and calls `destroy()` on the player when the directive's attributes change or the section unmounts.
- **Validation.** A missing or malformed video id (anything but 11 URL-safe characters) renders a `block-error` card instead of a broken frame.

On a phone the speed menu hides below 480 px to keep the bar on one line; everything else stays.

## Transcribing a passage from a record

The demo needed a phrase from a real recording with a timestamp a reader could check. The workflow that worked, and the one that did not:

1. **Find a published transcription, not just a video.** Hunter Close's transcription of Stan Getz's solo on "Pennies from Heaven" (1957, with the Oscar Peterson Trio) is a PDF with chorus marks and a tempo, which is what makes bar-to-time mapping possible. Scrolling-score videos exist but could not be verified.
2. **Decode the pitches programmatically rather than by eye.** The PDF was rendered at 400 dpi with pymupdf; noteheads were detected with numpy and scipy against the staff-line geometry and read off as pitches. The transcription is in bass clef for tenor; the ABC is in treble clef at concert pitch, which is a major ninth below what Getz's part would show.
3. **Map bars to time from chorus marks and tempo.** At 180 bpm a 4/4 bar is 1.33 s. The chorus top at 1:35 plus six bars gives bar 80 at 1:43; four bars end at about 1:48.3, so `end="1:49"` catches the resolution.
4. **Cross-check with an independent source.** A Jazz-Library post on the same solo cites 1:43 for the same lick, from a different listening.
5. **What failed.** Downloading the audio with yt-dlp to measure the tempo directly did not work (YouTube's bot check), and working around that check was out of bounds. Two agreeing written sources were taken as enough.
6. **Validate every block.** At the time, `abcjs.parseOnly` was run over each fence for its warnings. That does not check bar length (abcjs never does); the module lint now does both, through `app/shared/notation.ts`.

## Verification

Check the reader in a browser with the `agent-browser` CLI, which is the standing rule for this machine (`~/.claude/CLAUDE.md`); it starts muted. The original work did not: the Chrome extension was not connected, and the checks ran through raw headless Chrome: `--dump-dom` with a virtual time budget to read the rendered markup (the iframe source with `start=103&end=109`, the speed menu populated with 0.25× to 2×, the clock at `1:43 / 1:49`, zero error cards), and `--screenshot` of a static harness that mounts `Markdown.tsx` directly to check beaming, the transport bar and the player bar visually. The YouTube iframe keeps virtual time from settling, so a hard `--timeout` must cap the budget. Playback itself (the end-of-passage rewind, Reset) was checked by reading the code, not by ear.

A local Bun older than 1.2.3 cannot run `app/server.ts` (`Bun.serve` routes); this machine was upgraded to 1.4.4 during the work.

## The demo content, for reference

The original etude, written for the course:

```abc
X:1
T:Etude on a ii-V-I in C
C:Original, written for this course
M:4/4
L:1/8
Q:1/4=132
K:C
"Dm7" zFAc edcA | "G7" Bdfa gfed | "Cmaj7" e2 c2 B2 G2 | "A7" A2 ^G A2 z3 |
"Dm7" dcAF EDCB, | "G7" DFAc BGFD | "C6" EGce dcAG | E6 z2 |]
```

The transcribed phrase, bars 80 to 83 of the Getz solo, concert pitch:

```abc
X:2
T:Pennies from Heaven, Getz solo, bars 80 to 83
C:Stan Getz, 1957. Transcription by Hunter Close, concert pitch
M:4/4
L:1/8
Q:1/4=180
K:C
"Dm7" cA3 GCD^D | "G7" EGEC DFDA, | "C7" _B,DB,G, A,CA,^F, | G,_B,G,E, F,A,F,D, |]
```

The contrast block, the same opening with the D sharp replaced by a D natural:

```abc
X:3
M:4/4
L:1/8
Q:1/4=180
K:C
"Dm7" cA3 GCDD | "G7" EGEC DFDA, |]
```

```markdown
::youtube{v="-_lIEU7mz8s" t="1:43" end="1:49" title="Stan Getz and the Oscar Peterson Trio, Pennies from Heaven, 1957"}
```

The teaching point was the chromatic approach in bar 80: C, D, D sharp, with E landing on the downbeat of G7. The contrast block replaced the D sharp with a D natural to show the downbeat lose its lean.

Sources:

- Recording: Stan Getz and the Oscar Peterson Trio, Verve MG V-8251, recorded 10 October 1957. Reference upload `-_lIEU7mz8s`; other uploads of the same take `8ED8GJwCYIU` and `Z87JqmXCqv4`.
- Transcription: Hunter Close, March 2025, post at https://huntergclose.wp.txstate.edu/2025/03 and PDF at https://bpb-us-e1.wpmucdn.com/wp.txstate.edu/dist/5/4260/files/2025/03/Pennies-from-Heaven-3.pdf.
- Commentary: a Jazz-Library post on the solo (independent 1:43 timestamp) and the jazzsaxophonelessons page on Getz ii-V-I lines.
- Tooling: abcjs 6.7.2; the ABC standard v2.1 at https://abcnotation.com/wiki/abc:standard:v2.1; the YouTube IFrame Player API.
