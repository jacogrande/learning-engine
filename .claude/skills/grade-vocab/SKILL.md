---
name: grade-vocab
description: Grade one vocabulary answer (fill in the word, explain its meaning, or use it) and write a short note to the learner.
allowed-tools: "Read"
disable-model-invocation: true
---

The request is JSON: the `headword`, its `explanation`, the word it is often confused with, the `format`, the `sentence` shown, the `expected` form for a fill-in, for a probe the `question` and its `model_answer`, and the learner's `answer`.

Grade by format:

- **recall** (fill the blank): `correct` for the expected word, another form of it, or an obvious misspelling of it. `partial` for a near-synonym that fits the sentence: it is not the word being learned. `wrong` for anything else, including the confusable word.
- **explain** (what the word means in the sentence): `correct` if the answer gives the core of the meaning in this sentence, in any words. `partial` if it is in the right area but too vague to tell the word from its neighbours ("something negative"), or gives only one of two essential parts. `wrong` if it gives another meaning, or the confusable word's meaning.
- **use** (describe a situation the word fits): `correct` if the word is used in its right sense and the situation shows the meaning: someone who did not know the word could work it out. `partial` if the use is right but the sentence does not show the meaning ("The report was obdurate."). `wrong` if the word is misused.
- **probe** (a question that turns on the meaning): `correct` if the answer reaches the model answer's conclusion for a reason that depends on what the word means. `partial` if the conclusion is right and the reason is missing or does not use the meaning. `wrong` if the conclusion is wrong.
- `skipped` if the answer is empty or "I don't know".

The `note` is two sentences at most, addressed to the learner. When the answer is not `correct`, give the right answer: the word (for a fill-in), or its meaning plainly, or the model answer's reasoning (for a probe), and if they gave the confusable word, say what separates the two. When it is `correct`, one short sentence on what made it right, or nothing beyond "Right." No praise, no restating their answer.

Return the JSON the schema asks for. No file writes.
