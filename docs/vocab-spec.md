# Spec: Vocabulary

*Status: built 2026-11-01. Evidence check: the research notes behind each rule are summarised under [Evidence](#evidence).*

## What it is for

General English words the learner meets while reading and half-knows or does not know: *obdurate*, *sinecure*, *desultory*. In their own language, as an adult. Course terms are already taught and tested by the course; they can be captured too, but their home is the course's review.

Reading alone is slow: about 15% of unknown words are learned per encounter (Swanborn & de Glopper 1999). The system turns one encounter into a captured word, an entry, spaced review, and a short daily practice session.

## Goals

- Capture a word in one move from anywhere, with the sentence it was met in.
- An entry that teaches: a plain explanation, examples in varied contexts, the word it is confused with.
- Words join the daily review queue alongside course cards.
- A Train view that follows the evidence on vocabulary learning, not Anki's defaults.
- The courses know which words the learner is collecting and use them.

## Non-goals

- Foreign-language vocabulary. No keyword mnemonics, translation pairs, or audio. (Revisit if a second language is added.)
- A dictionary. Entries are written for this learner and this sense.
- Gamification beyond a progress ladder.

## Capture

| Where | How |
|---|---|
| A lesson | Select text → **Vocab** in the selection menu, or press **V** while the menu is up. |
| Anywhere | **Alt+V** opens an add box; a selection anywhere on the page fills the word and its sentence. **Add word** on the Vocabulary page does the same. |

Each capture records the word as selected, the sentence around it (from its paragraph), and the course, section and title it came from. A word already in the list, matched on the typed form or the entry's headword, gains the sentence as another context instead of a second entry.

**Course terms.** In a lesson, a word the section defines in bold is marked a course term. A course term's card belongs to that course's review (`/c/<slug>/review`) as well as the daily queue. The mark can be toggled on the word.

## The entry

A background job (`/vocab-entry`, `vocab` job, background lane) writes:

- `headword`, `pos`, `register`.
- `explanation`: one or two everyday sentences on how the word is used, in the sense met. No word rarer than the headword; never the headword itself. (Learner-friendly explanations beat dictionary definitions: McKeown 1993.)
- `examples`: four sentences, one per learner domain where it fits, each making the meaning inferable, with the exact `form` used so it can be blanked.
- `confusable`: the one word most likely to be mixed up with it, and what separates them.
- `parts`: word parts, only when they are a reliable hook.
- `probes`: three questions whose answer turns on the meaning ("Is an obdurate person easy to persuade? Why?") with a model answer.

The entry is editable on the Vocabulary page; **Rewrite entry** regenerates it. Once ready, the word gets a review card, first due the next day.

## Daily review

Vocab cards live in `cards` under the pseudo-course `_vocab` (`question` = word id). They share the FSRS scheduler, the daily cap, interleaving, suspend, flag, leech handling and the Cards page.

A card alternates direction, each time in a sentence from the entry it was not last asked in:

- **Meaning**: "What does **obdurate** mean in this sentence?"
- **Recall**: the sentence with the word blanked, plus the explanation: produce the word.

Practising both directions matters because practice transfers to the direction practised (Webb 2009; Nakata 2016).

**Grading.** Claude grades every answer (`/grade-vocab`), except a recall that matches the word or an inflection of it, which is marked correct at once. Before checking, the learner rates how hard the recall was: *Effortful*, *Some effort*, *Instant*. The FSRS rating comes from both:

| Graded | Rating |
|---|---|
| wrong or skipped | Again, whatever the learner felt |
| partial | Hard |
| correct + Effortful / Some effort / Instant | Hard / Good / Easy |

Correctness is checked, never self-reported; the self-rating only separates correct answers. Self-judgments run overconfident (Dunlosky & Rawson 2012), so they never rescue a wrong answer.

## Train

`/vocab/train`: a session of up to 12 words. Train never moves the review schedule; it moves the word up its **ladder**.

### The ladder

| Rung | Task | Graded by |
|---|---|---|
| 0 Meet | The explanation and one anchor sentence: where the word was met, else the first example. Nothing else. | — |
| 1 Pick | Choose the word that fits a sentence it has not been seen in, from four. | the page |
| 2 Recall | Type the word into a blanked sentence; first letter and length as the hint. | exact match, else Claude |
| 3 Explain | Say what the word means in a new sentence. | Claude |
| 4 Use | Answer a probe ("Would…? Why?"), or, every third time, describe a real situation the word fits so the meaning shows. | Claude |
| 5 Through | Upkeep: one of recall, explain, use. | |

### A session

1. **Which words.** Up to 5 new words (oldest first), then words lowest on the ladder not trained today, then two words through the ladder for upkeep. Suspended words are skipped. A new word whose confusable is also new waits for a later day.
2. **Three correct per word.** A word stays in the session until it has three correct answers (one for upkeep), each in a different sentence, with at least three other tasks between its attempts. Six attempts end its turn regardless.
3. **Every answer shows the full answer**: the sentence with the word filled in, the explanation, the probe's model answer. From rung 3 on, the confusable and its difference.
4. **A miss** sends the word back three tasks later, at the same rung.
5. **When a word's turn ends**: three correct with no misses climbs one rung, at most once a calendar day. Two misses drop one rung (never below Pick).

Meet is the only rung that is study; every other task is retrieval before the answer is shown.

### Why these rules

- **Three correct, then come back another day**, not one correct and done. Dropping a word after its first correct recall is the losing condition in Karpicke & Roediger (2008); three initial correct recalls followed by spaced relearning sessions is the recommendation from Rawson & Dunlosky (2011), and relearning erases most differences in the first session (Vaughn et al. 2016).
- **One rung a day.** New words consolidate after sleep (Dumay & Gaskell 2007); same-day fluency overstates learning. Climbing the five rungs takes at least four sessions on different days, about a dozen retrievals plus review cards, close to the ~10+ encounters rich instruction needed (McKeown et al. 1985).
- **Anchor, then vary.** A new word is anchored in one clear context before varied ones (Mak, Hsiao & Nation 2021); tests then use sentences not seen, because varied contexts help on new contexts (Bolger et al. 2008; Norman et al. 2023).
- **Probes, not "write a sentence".** Free sentence writing tests poorly (Folse 2006; Barcroft 2004); a sentence can use a word without showing what it means. Probes force the meaning to show (Beck, McKeown & Kucan; practitioner guidance, not a controlled finding).
- **The full answer after every attempt.** Feedback that gives the correct answer after an error raised one-week retention sharply; right/wrong alone did nothing (Pashler et al. 2005).
- **Confusables apart.** Related words learned together cause more mix-ups (Nakata & Suzuki 2019); contrast them once the word is known. The confusable is never a Pick distractor.
- **Pick first is a scaffold.** Recognition is the easiest format (Laufer & Goldstein 2004). No study shows recognition-first beats starting at recall, so Pick is one rung, and it is skipped when the list has too few words for fair distractors.
- **Spacing.** The strongest evidence of all, on adults learning English word definitions (Kornell 2009; Cepeda et al. 2006). Review supplies it; Train's one-session-a-day rule protects it. The end-of-session screen says plainly that spacing feels worse while it works better.

## The course connection

Each course's `learner.md` gets `vocab_words: { learning: [...], owns: [...] }`: the words captured while reading that course. A word moves to `owns` once through the ladder or learned in review. `generate-module` uses one or two `learning` words in examples where they fit, unglossed: another encounter in a new context.

The course Notebook lists the words captured in that course.

## Data

- `vocab` table, one state file per word in `library/state/vocab/<id>.json` (synced like every other state file): `word`, `contexts[]` (`text`, `form`, `course`, `doc`, `title`, `at`), `course_term`, `entry`, `status` (`pending` · `ready` · `failed`), `stage`, `train_log[]`, `trained_at`.
- The card: `cards` row with `course='_vocab'`, `question=<id>`, `doc='vocab/<id>'`, `module=<course slug>` for a course term. Review attempts go in the card's log with the format asked.
- Dummy cards never include vocab cards.

## API

| Route | |
|---|---|
| `GET/POST /api/vocab` | list with counts; capture |
| `GET/PUT/DELETE /api/vocab/:id` | read, edit the entry or course-term mark, delete with its card |
| `POST /api/vocab/:id/regenerate` | rewrite the entry |
| `GET /api/vocab/train` | today's session |
| `GET /api/vocab/:id/task` | the next task for a word |
| `POST /api/vocab/:id/meet` | met: rung 0 → 1 |
| `POST /api/vocab/:id/answer` | an attempt (`mode`: review or train); exact results return at once, the rest arrive as a `vgrade` event |
| `POST /api/vocab/:id/finish` | end a word's turn in a session: climb, drop or stay |

## Evidence

Verdicts from the evidence check (2026-11-01). Few studies test adult native speakers on real rare words; the closest evidence is adult pseudoword-in-English studies, then child instruction and L2 word pairs.

| Claim | Verdict |
|---|---|
| Rich, learner-friendly instruction beats definitions | Supported for children (McKeown et al. 1985; McKeown 1993); plausible for adults |
| Varied contexts help | Partly: helps on new contexts, after anchoring (Bolger et al. 2008; Mak et al. 2021; Norman et al. 2023) |
| Retrieval beats restudy | Supported (Karpicke & Roediger 2008; van den Broek et al. 2018) |
| Criterion and relearning | Supported, with the correction above (Pyc & Rawson 2009; Rawson & Dunlosky 2011; Vaughn et al. 2016) |
| Spacing | Supported, strongest (Kornell 2009; Cepeda et al. 2006) |
| Recognition → recall → production order | Difficulty order real (Laufer & Goldstein 2004); sequencing benefit unshown |
| Writing your own sentence | Weak (Folse 2006; Barcroft 2004; Webb 2005); constrained prompts are practitioner advice |
| Contrasting confusables | Unclear (Nakata & Suzuki 2019) |
| Word parts | Modest, children only (Goodwin & Ahn 2013) |
| Full-answer feedback after errors | Supported (Pashler et al. 2005; Metcalfe et al. 2009) |
| Self-rated difficulty as scheduler input | Unclear; correctness carries the weight (Lindsey et al. 2014; Dunlosky & Rawson 2012) |

## Open questions

- Delayed feedback beat immediate for adult vocabulary (Metcalfe et al. 2009), partly by spacing the last exposure. Train gives feedback at once; worth testing a delayed review of the session's misses at its end.
- Whether self-rated difficulty improves FSRS fit for vocab cards over correctness alone. After ~400 vocab reviews, compare.
- Leeches: a word that lapses six times is suspended like any card. For vocab, rewriting the entry may be the better first response.
