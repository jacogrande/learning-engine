# Music notation and recorded passages in the reader

Date: 2026-11-02. The reader can now engrave staff notation from a fenced block, play it, and embed a player for one cited passage of a YouTube recording. This note records how each piece works, the decisions behind it, and the workflow used to transcribe a phrase from a record. The demo course that exercised all of it (`music-notation-demo`) has been deleted; its content is reproduced at the end so the examples survive.

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

1. **Dynamic import.** abcjs is imported on first use, like mermaid, so a course with no music never loads it. The module shape differs by bundler: sometimes `renderAbc` is on the module, sometimes on `module.default`. The component checks for `default.renderAbc` and uses whichever has it. Without this check every block rendered as an error card.
2. **Engraving.** `renderAbc` is called with `responsive: "resize"` so the SVG fits the reading column, `add_classes: true` so each note is an addressable element, `foregroundColor: "currentColor"` so the score follows the theme, and zero padding so the figure aligns with the prose. A tune with no lines, or a thrown parse error, becomes a `block-error` card showing the source, per the "fail per block, never per page" rule.
3. **Audio.** If `synth.supportsAudio()` is true, a `SynthController` is loaded into a sibling div with `displayPlay`, `displayProgress`, `displayRestart`, `displayLoop` and `displayWarp` on. `setTune(tune, false)` prepares the audio lazily; the soundfont streams from abcjs's default CDN on the first press of play. The cursor-control callbacks add an `is-playing` class to the elements of the sounding note and clear it on the next event or at the end, which is what lights notes in the accent colour.
4. **Cleanup.** The effect pauses the controller on unmount so navigating away stops the sound.

Styling: abcjs expects its own stylesheet for the transport bar. Instead, `styles.css` restyles `.abcjs-inline-audio` with the app's tokens (buttons, pushed state, progress bar, clock, tempo input) and hides the `.abcjs-css-warning` badge abcjs shows when it does not detect its stylesheet.

## How the `::youtube` directive renders

### Parsing

The app already uses remark-directive, and a plugin maps container (`:::`) and leaf (`::`) directives to a `div` with `data-directive` and the attributes as props. The `div` component then dispatches on the directive name; `youtube` goes to a `YouTube` component, everything else stays a callout.

One parsing fix was needed. remark-directive also treats inline `:name` as a text directive, which swallowed ordinary prose such as "at 1:43" (the `:43` became a directive and vanished). The plugin now converts any `textDirective` node back into the literal text it came from.

### The player

The first version was a plain `<iframe>` with `?start=`. The request for a player that plays only the passage, keeps speed control and has a reset button needed the YouTube IFrame Player API, which is the only supported way to seek, pause, read the current time and set the rate from the page.

- **Loading the API.** `https://www.youtube.com/iframe_api` is injected once per page behind a module-level promise. The script calls a global `onYouTubeIframeAPIReady`; the loader chains any existing handler and resolves with `window.YT`. If `YT.Player` is already present the promise resolves immediately.
- **Creating the player.** `new YT.Player(el, …)` replaces a mount div inside the 16:9 frame with the iframe. `host` is the nocookie domain, so YouTube sets no tracking cookies until the reader presses play. Player vars: `start`, `end`, `controls: 0` (hide YouTube's chrome), `rel: 0`, `fs: 0`, `disablekb: 1`, `iv_load_policy: 3`, `playsinline: 1`, and `origin` set to the page origin so postMessage is accepted. A poster from `i.ytimg.com` is the frame's background until the API is ready.
- **Keeping the bounds.** YouTube honours `end` only until the first seek; after a `seekTo` the video runs on. The component therefore polls `getCurrentTime()` every 100 ms while mounted. When playback is at or past `end`, it pauses and seeks back to `t`, which leaves the player cued for the next press. If the video reaches its own end (no `end` given), the `ENDED` state does the same. This also avoids YouTube's end screen.
- **Controls.** Play/pause calls `playVideo` or `pauseVideo`; the icon follows `onStateChange`, so a click on the video itself stays in sync. Reset calls `seekTo(t, true)` then `playVideo()`. The scrubber maps a click's fraction of its width to a time inside the passage. The speed menu is filled from `getAvailablePlaybackRates()` once the player is ready, so it offers exactly what YouTube offers for that video, and `setPlaybackRate` applies the choice. Buttons are disabled and the bar dimmed until `onReady`.
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
6. **Validate every block.** `abcjs.parseOnly` on each fence confirms every bar sums to the meter and reports warnings; a scratch script ran this across all blocks before each check-in.

## Verification without a browser extension

The Chrome extension was not connected, so checks ran through headless Chrome: `--dump-dom` with a virtual time budget to read the rendered markup (the iframe source with `start=103&end=109`, the speed menu populated with 0.25× to 2×, the clock at `1:43 / 1:49`, zero error cards), and `--screenshot` of a static harness that mounts `Markdown.tsx` directly to check beaming, the transport bar and the player bar visually. The YouTube iframe keeps virtual time from settling, so a hard `--timeout` must cap the budget. Playback itself (the end-of-passage rewind, Reset) was checked by reading the code, not by ear.

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

```markdown
::youtube{v="-_lIEU7mz8s" t="1:43" end="1:49" title="Stan Getz and the Oscar Peterson Trio, Pennies from Heaven, 1957"}
```

The teaching point was the chromatic approach in bar 80: C, D, D sharp, with E landing on the downbeat of G7. The contrast block replaced the D sharp with a D natural to show the downbeat lose its lean.

Sources:

- Recording: Stan Getz and the Oscar Peterson Trio, Verve MG V-8251, recorded 10 October 1957. Reference upload `-_lIEU7mz8s`; other uploads of the same take `8ED8GJwCYIU` and `Z87JqmXCqv4`.
- Transcription: Hunter Close, March 2025, post at https://huntergclose.wp.txstate.edu/2025/03 and PDF at https://bpb-us-e1.wpmucdn.com/wp.txstate.edu/dist/5/4260/files/2025/03/Pennies-from-Heaven-3.pdf.
- Commentary: a Jazz-Library post on the solo (independent 1:43 timestamp) and the jazzsaxophonelessons page on Getz ii-V-I lines.
- Tooling: abcjs 6.7.2; the ABC standard v2.1 at https://abcnotation.com/wiki/abc:standard:v2.1; the YouTube IFrame Player API.
