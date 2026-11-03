---
name: transcribe
description: Quote a phrase from a real recording as a score with a passage player, sourced from a published transcription and checked against the record. Read by generate-module, add-lesson and module-researcher; not run on its own.
allowed-tools: "Read,Write,WebSearch,WebFetch,Bash"
disable-model-invocation: true
---

A phrase a section quotes from a record is shown three ways: the prose names it (player, tune, album, year, timestamp), an `abc` score shows it, and a `::youtube` passage plays it. All three must agree, and every one of them must be checkable by the reader. This is the workflow that produced the course's first verified example (Getz, "Pennies from Heaven", 1957; see `docs/music-notation.md`). Paths are under `library/content/courses/<slug>/`; downloads go in `modules/<id>/research/sources/`.

## 1. Choose the phrase from the record, not from memory

Pick a passage where the device the section teaches is audible and short: two to eight bars. Prefer canonical recordings of standards and solos players actually learn (Wes Montgomery, Grant Green, Jim Hall, Joe Pass, Kenny Burrell, Charlie Parker, Miles Davis, Sonny Rollins, Stan Getz and so on, as the course asks), over method-book licks. Name the recording exactly: leader, tune, album, label and catalogue number when known, recording date.

## 2. Find a published transcription

Search for a transcription of that solo with bar numbers or chorus marks: a PDF from the transcriber, a university or teacher's site, a book page you can cite, a site such as Jazz Guitar Online or Learn Jazz Standards that prints the notes. Record the URL and the transcriber. A scrolling-score video, a forum post without notation, or your own recall is not a transcription. If none exists for the passage you wanted, choose another passage or another recording; do not transcribe by ear and present it as the player's.

Download the PDF or page with `curl -sL -o modules/<id>/research/sources/<name>.pdf <url>`.

## 3. Read the notes off the page

Render the pages: `pdftoppm -r 300 -png <file>.pdf modules/<id>/research/sources/<name>`. Crop the bars you need to their own image so each bar is large enough to read (`uv run --with pillow python -c "…"`), and Read the crop. For a cleanly engraved score you may instead decode noteheads against the staff-line geometry with a short script (`uv run --with pymupdf --with numpy --with scipy python …`), as the Getz example did.

Read every note twice. First from the image: pitch, accidental (carried through the bar), duration, ties, rests. Then against the harmony: each note on a beat is a chord tone, an approach tone or a tension you can name over the chord the transcription prints. A note that fails the second check is re-read on the image; if it still fails, the bar is not quoted. Never fill a gap with a note that "should" be there.

Pitch level:
- A guitar part is written an octave above where it sounds. Write it as the transcription prints it, with `clef=treble-8` on the `K:` line (`K:F clef=treble-8`): the score reads like guitar music and the player sounds it at true pitch.
- Any other instrument is written at concert pitch. A tenor or trumpet transcription in B flat comes down a major second (tenor parts printed in bass clef are already concert); an alto or baritone in E flat comes down a major sixth. The prose says what was done ("concert pitch; the tenor part reads a major ninth higher").

## 4. Find the passage on the record

Find the recording on YouTube, preferring the label's or the artist's own upload (the "– Topic" channels that say "Provided to YouTube by …"). Never download audio or video from YouTube, and never work around a bot check.

Map the bars to time: take the timestamp where the chorus or the solo starts, from the transcription, a lesson that cites it, or a second listening source, then add bars × (beats per bar × 60 / tempo). Confirm the result against a second, independent source that cites the same moment. With two sources that agree within a second, give `t` a second before the phrase and `end` a second after it. Without two, do not embed the passage: name the recording and say "about m:ss" in the prose.

## 5. Write the score

````markdown
```abc
X:1
T:<Tune>, <player> solo, bars <n> to <m>
C:<Player>, <year>. Transcription by <transcriber>
M:4/4
L:1/8
Q:1/4=<tempo from the transcription or the record>
K:<key> clef=treble-8
%%MIDI swing 66
"Gm7" … | "C7" … |]
```
````

Follow the content grammar's notation rules: chord symbols quoted before their note, eighths of a beat group beamed together, every bar full (a pickup and its complement excepted). Swung eighths stay plain eighths with `%%MIDI swing`. Leave out what the transcription does not show; add nothing it does not.

An example written for the course (an etude, a contrast version of a phrase with one note changed) says so: `C:Original, written for this course`. It never borrows a player's name.

## 6. Check it

Run `bun run scripts/check-notation.ts <file>` on the section or on a `.abc` file holding the tune. It reports parser warnings, bars that do not fill the meter, and malformed passages, and it asks YouTube whether each video exists and can be embedded, printing its title and channel. Fix every problem. Confirm the printed title and channel are the recording the prose names; if not, find the right upload.

## 7. Record the chain

In the research file, under the objective, add a `### Transcribed passage` block: the recording (leader, tune, album, label, date), the video id with its oEmbed title and channel, `t` and `end` with the two timestamp sources, the transcription URL and transcriber, the bars quoted, the pitch level (as printed for guitar, or transposed how), any bar left out and why, and the ABC exactly as the section will print it. The section author copies the block; nothing in the section may go beyond it.
