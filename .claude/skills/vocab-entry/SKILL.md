---
name: vocab-entry
description: Write a vocabulary entry for one general English word the learner met while reading — a plain explanation, teaching examples in varied contexts, test sentences, and the word it is most often confused with.
allowed-tools: "Read"
disable-model-invocation: true
---

The request gives the word as captured, the sentence it was met in (if any), and the learner's domains. The learner is an adult native speaker. The word is ordinary English they half-know or do not know, not a course term.

1. **headword**: the dictionary form (`obdurate`, not `obdurately`; a phrase stays a phrase). If the capture is a typo, use the word clearly meant.
2. **pos**: part of speech, in the sense used in the sentence.
3. **explanation**: one or two sentences in everyday words that say how the word is used: who or what it describes, and in what kind of situation. Write "If someone is obdurate, they refuse to change their mind even when they should", not "stubbornly persistent; unyielding". No word rarer than the headword. Never use the headword or its relatives inside the explanation. Explain only the sense the sentence uses; if there is no sentence, the most common sense.
4. **forms**: the headword and every inflection or derived form a reader would accept as the same word (`obdurate`, `obdurately`, `obduracy`). A fill-in that matches one of these is marked correct without a grader, so list only real forms of this word, never a near-spelling of a different word.
5. **examples**: four sentences, each from a different context: one from each of the learner's domains where the word fits naturally, the rest from everyday life. Each sentence must make the meaning inferable to someone who did not know the word: the surrounding words point at it (a contrast, a cause, a consequence). Vary the form (`obdurate`, `obdurately`, `obduracy`) only where natural. `form` is the exact string as it appears in `sentence`, so it can be blanked out. Do not reuse the captured sentence. These sentences teach: the learner reads them.
6. **tests**: six more sentences the learner never sees before being tested on them. Each is natural and fits only this word, in this sense, but does not explain it: someone who did not know the word could not work out its meaning from the rest of the sentence. No contrast or definition built in ("Despite every appeal, the obdurate judge refused" gives it away; "The committee found the chair obdurate on the question of funding" does not). Vary the contexts and forms as for the examples, and keep each one distinct from every example. `form` as above.
7. **confusable**: the one word a reader is most likely to mix it up with, by sound or by near meaning (`obdurate` / `obstinate`), and `difference`: one sentence on what separates them, with the case where only one fits. `null` if no word is a real risk.
8. **parts**: the word's parts, only when they help a reader remember or work out the meaning (`ob-` against + `durare` harden). `null` when the parts are opaque or misleading.
9. **probes**: four questions whose answer can only be right if the learner knows what the word means, each with a short model `answer` that gives the reason. Use yes/no-with-a-reason ("Is an obdurate person easy to persuade?" → "No: obdurate means refusing to change your mind, so persuasion fails"), a choice between two cases ("Which is obdurate: a manager who reverses a decision after new data, or one who keeps it despite the data?"), or a reason ("Why might a negotiator call the other side obdurate?"). Never ask for a definition or for "a sentence using the word".
10. **register**: where the word lives (`formal`, `literary`, `technical`, `informal`, `dated`), or `null` for neutral.

When the request asks for new test sentences only, it gives the word, its sense and every sentence the learner has already seen. Return six `tests`, written to rule 6, each different from those sentences in context and wording.

Return the JSON the schema asks for. No file writes. No commentary.
