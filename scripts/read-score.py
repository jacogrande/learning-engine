# Read a machine-readable transcription (MIDI, MusicXML, .mxl, MuseScore's exports) and print the
# bars asked for as ABC note text, one line per bar, so a phrase is copied from the file rather than
# reconstructed by eye. Used by the transcribe skill.
#
#   uv run --with music21 python scripts/read-score.py <file> [--bars 5-8] [--part 0] [--meter 4/4]
#        [--quantize 4] [--octave 0] [--summary]
#
# --summary lists parts, meter, key, tempo marks, bar count and the first bar's notes, to find the
# solo. --quantize is divisions per quarter for a played (unquantized) MIDI file: 4 for sixteenths,
# 3 for eighth triplets, 12 for both. --octave shifts every note by octaves (+1 to write a sounding
# guitar line at guitar pitch for clef=treble-8). Output uses L:1/8; triplets are written (3abc.
import argparse
from fractions import Fraction

from music21 import converter, meter, note, chord, stream, tempo, key

ap = argparse.ArgumentParser()
ap.add_argument("file")
ap.add_argument("--bars", default=None)
ap.add_argument("--part", type=int, default=0)
ap.add_argument("--meter", default=None)
ap.add_argument("--quantize", type=int, default=0)
ap.add_argument("--octave", type=int, default=0)
ap.add_argument("--summary", action="store_true")
a = ap.parse_args()

# A MIDI file is quantized as it is read (music21's default is sixteenths and eighth triplets).
is_midi = a.file.lower().endswith((".mid", ".midi"))
score = converter.parse(a.file, quarterLengthDivisors=(a.quantize,)) if (a.quantize and is_midi) else converter.parse(a.file)
if a.quantize and not is_midi:
    score = score.quantize((a.quantize,), processOffsets=True, processDurations=True, inPlace=False)
parts = score.parts if score.parts else [score]
part = parts[a.part]
if a.meter or not part.recurse().getElementsByClass(meter.TimeSignature):
    part.insert(0, meter.TimeSignature(a.meter or "4/4"))
measures = part.makeMeasures() if not part.getElementsByClass(stream.Measure) else part.getElementsByClass(stream.Measure)


def abc_pitch(p):
    names = {"C": "C", "D": "D", "E": "E", "F": "F", "G": "G", "A": "A", "B": "B"}
    acc = {"#": "^", "-": "_", "##": "^^", "--": "__", "": ""}
    alter = p.accidental.modifier if p.accidental else ""
    s = acc.get(alter, "") + names[p.step]
    o = p.octave + a.octave
    if o >= 5:
        s = s.lower() + "'" * (o - 5)
    else:
        s = s + "," * (4 - o)
    return s


def abc_len(ql):
    n = Fraction(ql).limit_denominator(48) * 2  # quarter lengths in eighths
    if n == 1:
        return ""
    if n.denominator == 1:
        return str(n.numerator)
    if n.numerator == 1:
        return "/" + str(n.denominator)
    return f"{n.numerator}/{n.denominator}"


def bar_text(m):
    out, i = [], 0
    # A MIDI import puts a bar's notes in voices; read the first voice, or the bar itself.
    vs = list(m.voices)
    els = list((vs[0] if vs else m).notesAndRests)
    while i < len(els):
        e = els[i]
        ql = Fraction(e.duration.quarterLength).limit_denominator(48)
        # eighth-note triplets: three notes of 1/3 quarter each
        if ql == Fraction(1, 3) and i + 2 < len(els) and all(Fraction(x.duration.quarterLength).limit_denominator(48) == Fraction(1, 3) for x in els[i:i + 3]):
            out.append("(3" + "".join(token(x, Fraction(1, 2)) for x in els[i:i + 3]))
            i += 3
            continue
        out.append(token(e, ql))
        i += 1
    return " ".join(out)


def token(e, ql):
    tie = "-" if (e.tie and e.tie.type in ("start", "continue")) else ""
    if isinstance(e, note.Rest):
        return "z" + abc_len(ql)
    if isinstance(e, chord.Chord):
        return "[" + "".join(abc_pitch(p) for p in e.pitches) + "]" + abc_len(ql) + tie
    return abc_pitch(e.pitch) + abc_len(ql) + tie


if a.summary:
    print(f"parts: {len(parts)}", [getattr(p, "partName", None) for p in parts])
    print("meter:", [str(t.ratioString) for t in part.recurse().getElementsByClass(meter.TimeSignature)][:3])
    print("key:", [str(k) for k in part.recurse().getElementsByClass((key.Key, key.KeySignature))][:3])
    print("tempo:", [f"{t.number}" for t in score.recurse().getElementsByClass(tempo.MetronomeMark)][:3])
    print("bars:", len(measures))
    if len(measures):
        print("bar 1:", bar_text(measures[0]))
    raise SystemExit

lo, hi = 1, len(measures)
if a.bars:
    lo, hi = (int(x) for x in (a.bars.split("-") + [a.bars])[:2])
for n, m in enumerate(measures, 1):   # by position: a MIDI file has no bar numbers of its own
    if lo <= n <= hi:
        print(f"bar {n}: {bar_text(m)} |")
