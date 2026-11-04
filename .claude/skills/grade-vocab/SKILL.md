---
name: grade-vocab
description: Grade one vocabulary answer (fill in the word, explain its meaning, use it, or tell it from its near-synonyms) and write a short note to the learner.
allowed-tools: "Read"
disable-model-invocation: true
---

The request is JSON: the `headword`, its `explanation`, the word it is often confused with, the `format`, the `sentence` shown, the `expected` form for a fill-in, for a probe the `question` and its `model_answer`, for a family question the member `word` and its `model_answer`, for a nuance question the `neighbours` (each with its `difference` from the headword) and a `model_answer` made of them, and the learner's `answer`.

Grade by format:

- **recall** (fill the blank): `correct` for the expected word, another form of it, or an obvious misspelling of it. `partial` for a near-synonym that fits the sentence: it is not the word being learned, and it counts as a miss. `wrong` for anything else, including the confusable word.
- **explain** (what the word means in the sentence): `correct` if the answer gives the core of the meaning in this sentence, in any words. `partial` if it is in the right area but too vague to tell the word from its neighbours ("something negative"), or gives only one of two essential parts. `wrong` if it gives another meaning, or the confusable word's meaning.
- **use** (describe a situation the word fits): `correct` if the word is used in its right sense and the situation shows the meaning: someone who did not know the word could work it out. `partial` if the use is right but the sentence does not show the meaning ("The report was obdurate."). `wrong` if the word is misused.
- **probe** (a question that turns on the meaning): `correct` if the answer reaches the model answer's conclusion for a reason that depends on what the word means. `partial` if the conclusion is right and the reason is missing or does not use the meaning. `wrong` if the conclusion is wrong.
- **family** (given the headword and its explanation, what one member of its family means; `word` is the member, `model_answer` its meaning): `correct` if the answer gives the core of the member's meaning in any words, worked out from the headword's. `partial` if it is in the right area but loose, or gives the headword's meaning without the change the member makes (a noun for the state, a verb for the act). `wrong` if it gives another meaning. The note says the member's meaning plainly when the answer is not `correct`.
- **nuance** (when to use the headword rather than its near-synonyms): `correct` if the answer names what separates the headword from the neighbours, in any words, for at least the neighbour nearest in meaning: the case where only the headword fits, or what the headword carries that they lack. `partial` if it separates the headword from some neighbours but treats the nearest as the same, or gives the headword's meaning without a contrast. `wrong` if it reverses a difference or describes a different word. The note states the difference the answer missed, in one sentence per neighbour at most.
- `skipped` if the answer is empty or "I don't know".

The `note` is two sentences at most, addressed to the learner. When the answer is not `correct`, give the right answer: the word (for a fill-in), or its meaning plainly, or the model answer's reasoning (for a probe), and if they gave the confusable word, say what separates the two. When it is `correct`, one short sentence on what made it right, or nothing beyond "Right." No praise, no restating their answer.

Return the JSON the schema asks for. No file writes.
