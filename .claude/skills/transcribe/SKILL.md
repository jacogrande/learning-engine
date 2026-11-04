---
name: transcribe
description: Quote a phrase from a real recording as a score with a passage player, sourced from a published transcription and checked against the record. Read by generate-module, add-lesson and module-researcher; not run on its own.
allowed-tools: "Read,Write,WebSearch,WebFetch,Bash"
disable-model-invocation: true
---

A phrase a section quotes from a record is shown three ways: the prose names it (player, tune, album, year, timestamp), an `abc` score shows it, and a `::youtube` passage plays it. All three must agree, and every one of them must be checkable by the reader. This is the workflow that produced the course's first verified example (Getz, "Pennies from Heaven", 1957; see `docs/music-notation.md`). Paths are under `library/content/courses/<slug>/`; downloads go in `modules/<id>/research/sources/`.

## 1. Start from where good transcriptions are

The best phrase is one you can read exactly and place exactly. Choose recordings for their sources, not only for the player: any artist in the jazz tradition will do (guitarists such as Wes Montgomery, Grant Green, Kenny Burrell, Jim Hall, Joe Pass, Pat Martino, Charlie Christian; horn and piano players such as Charlie Parker, Sonny Rollins, Dexter Gordon, Clifford Brown, Lee Morgan, Stan Getz, Chet Baker, Miles Davis, John Coltrane, Bud Powell, Red Garland). Search with the device and the tune together ("Grant Green enclosure transcription", "Wes Montgomery guide tones ii-V lick transcription pdf", "<tune> solo transcription musicxml"), across lesson blogs, teachers' sites, university pages and transcription archives: Jazz Guitar Online (jazzguitar.be), Learn Jazz Standards, Jens Larsen, Matt Warnock, Jazz-Library, Hunter Close, MuseScore, Ted Gioia, and the many players who post PDFs of their own transcriptions. A blog that analyses a phrase and prints it in notation, with the recording and moment named, is a source.

Pick a passage of two to eight bars where the device the section teaches is audible. Name the recording exactly: leader, tune, album, label and catalogue number when known, recording date.

## 2. Prefer a source you can read exactly

In this order:

1. **Machine-readable**: MusicXML, `.mxl`, MIDI, or a MuseScore file exported to one of those. Download it and read it with `uv run --with music21 python scripts/read-score.py <file> --summary`, then `--bars <a>-<b>` for the passage. It prints the bars as ABC note text. For a played (unquantized) MIDI file, add `--quantize 2` for straight eighths (swing is set later with `%%MIDI swing`) or `--quantize 12` to keep triplets; a bracket of adjacent pitches such as `[G^GG]` is a grace note or a fast turn the quantizing collapsed: resolve it at `--quantize 12` or against a printed source. A file's bars are numbered from its first bar, so find the solo's start with the summary and the page.
2. **Notation printed on a web page or an engraved PDF**: notes and accidentals you can read cleanly in a crop. Render a PDF with `pdftoppm -r 300 -png`, crop the bars to their own image (`uv run --with pillow python -c "…"`), and Read the crop. A clean engraving can also be decoded against the staff lines with a short script (`uv run --with pymupdf --with numpy --with scipy python …`).
3. **Not usable**: hand-written or cursive-font scores you cannot read note for note, scrolling-score videos, prose that describes notes without printing them, and your own recall. Skip the source and find another; there are always more recordings.

Record the URL and the transcriber. Download into `modules/<id>/research/sources/` with `curl -sL -o …` (the folder is never committed).

## 3. Read every note twice

First from the source: pitch, accidental (carried through the bar), duration, ties, rests. Then against the harmony: each note on a beat is a chord tone, an approach tone or a tension you can name over the chord the source prints. A note that fails the second check is read again from the source; if it still fails, the bar is not quoted. Never fill a gap with a note that "should" be there.

Pitch level:
- A guitar part is written an octave above where it sounds. Write it as guitar music is printed, with `clef=treble-8` on the `K:` line (`K:F clef=treble-8`): the score reads like guitar music and the player sounds it at true pitch. A MIDI or MusicXML file holds sounding pitch: add `--octave 1` to write it at guitar pitch.
- Any other instrument is written at concert pitch. A tenor or trumpet transcription in B flat comes down a major second (tenor parts printed in bass clef are already concert); an alto or baritone in E flat comes down a major sixth. A MIDI file is already concert. The prose says what was done ("concert pitch; the alto part reads a major sixth higher").

## 4. Place the passage on the record

Find the recording on YouTube, preferring the label's or the artist's own upload (the "– Topic" channels that say "Provided to YouTube by …"). Never download audio or video from YouTube, and never work around a bot check.

The timestamp is good enough to embed when one of these holds:
- the transcription, or a lesson that prints the phrase, gives the time itself;
- a source gives the time the solo or a chorus starts, and the phrase's time follows from bars × (beats per bar × 60 ÷ tempo), with the tempo from the transcription; or
- two sources give the moment independently.

Then check the time against the form: the head of a 12-bar blues at 200 bpm lasts about 14 seconds a chorus, a 32-bar tune at 160 about 48; the solo cannot start before the head ends, and the phrase's chorus and bar must fall inside the video's length. If the arithmetic and the form disagree by more than a bar, do not embed. Give `t` one or two seconds before the phrase and `end` one or two after, so the reader hears it arrive. The prose says how the time was found when it was computed ("the second chorus starts at 1:12; bar 5 of it falls at about 1:19").

Without a time that passes this check, quote the score anyway if its notes are verified, name the recording and the chorus and bar in the prose, and leave out the `::youtube` passage.

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

In the research file, under the objective, add a `### Transcribed passage` block: the recording (leader, tune, album, label, date), the video id with its oEmbed title and channel, `t` and `end` with how each was found (printed, computed from which start time and tempo, or two sources) and the form check, the transcription URL, its format (MusicXML, MIDI, engraved PDF, web page) and transcriber, the bars quoted, the pitch level (as printed for guitar, or transposed how), any bar left out and why, and the ABC exactly as the section will print it. The section author copies the block; nothing in the section may go beyond it.
