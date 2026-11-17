---
name: start-brief
description: Start a brief, a one-module course for getting up to speed on a niche topic fast (usually for work). Research the topic's landscape, and write the scaffold and a one-module outline. No baseline.
argument-hint: "<topic>"
allowed-tools: "Read,Write,Glob,Agent,AskUserQuestion"
disable-model-invocation: true
---

Topic: $ARGUMENTS

A brief is for a learner who has been handed something to build or decide on in an unfamiliar domain, such as a feature for admins managing campsite availability rules. They need what a person who has worked in the space for a year carries in their head: the vocabulary, the common patterns and why each exists, what is at stake, what practitioners and users argue about, and who already ships what. They need it fast and applied to their own work. No baseline and no module ladder: one module.

## 1. Clarify

Ask, in one round: what they are building or deciding (the feature, the users, the product it sits in), what they need to be able to do afterward (spec it, review a design, talk to customers, pick a vendor), and what they already know. Skip what the topic line answers. If the message already carries the answers (the app sends them), ask nothing.

The slug: if the message gives `Slug: <slug>`, use it exactly. Otherwise pick a short kebab-case one. Stop and ask if `library/content/courses/<slug>/` already exists.

## 2. Research

Launch one `topic-researcher` per facet, all in parallel. Each prompt states the topic; what the learner is building; that this is a practitioner brief, not a textbook; this facet; the other facets by name, so it stays out of them; and the output path `library/content/courses/<slug>/research/<facet>.md`.

- `terms`: the domain's vocabulary as practitioners use it. Each term gets a one-line definition, the distinction from the term it is confused with, and who says it (operators, vendors, end users). Mark terms that mean different things in different products.
- `patterns`: the recurring designs and rules in the space, each with the problem it solves, a concrete example from a real product, and the failure it causes when misapplied. For a product topic this means data models, rule types, admin workflows and edge cases.
- `stakes`: why it matters. What goes wrong when it is done badly (revenue, fairness, support load, regulation, trust) with real cases and numbers where the sources have them.
- `discourse`: what people say. Recurring complaints and requests from users and operators (forums, reviews, support threads, Reddit, industry press), live debates among practitioners, and the opinions a newcomer will hear in meetings.
- `landscape`: who ships what. The main products and vendors, how each approaches the problem, where they differ, and what is table stakes against what is a differentiator. Link to public docs, help centres and changelogs.

Wait for all, then read the files; do not rely on the agents' replies.

Write `research/map.md`: the territory on one page. The ten to twenty terms that matter most, the patterns grouped by the problem they solve, the two or three decisions the learner's feature will force, the misconceptions a newcomer brings, and the open questions the sources disagree on. `/generate-module` plans from this file.

## 3. Scaffold

Write `library/content/courses/<slug>/course.md`:

```markdown
---
title: "<Topic, as a thing: Campsite availability rules>"
format: brief
depth: practitioner
folder: "<the Folder line from the message's filing block; omit when there is none>"
review: false   # only when the filing block says daily review is off
goals:
  - "<what the learner needs to be able to do, in their words>"
---
<One paragraph: what this brief covers and the work it serves. Voice rules apply.>
```

Write `library/content/courses/<slug>/learner.md`, frontmatter `title: "Learner"` and `domains:` listing what they are building first, then the products and roles from the research the examples should come from. Add `level:` with every objective from step 4 at `novice`, unless what they already know says otherwise.

## 4. Outline: one module

Write `library/content/courses/<slug>/outline.md` with exactly one module, id `01-<short-slug>`, and 3–5 objectives. Draw them from the facets so the module covers the landscape a practitioner holds, each concrete and testable and aimed at the learner's feature. For example:

- "Define the core terms and tell apart the pairs newcomers confuse"
- "Choose among the common rule patterns for a given requirement and name the failure each risks"
- "Explain what a bad implementation costs, to whom, with a real case"
- "Compare how the main products handle it and say where the learner's feature should sit"

Use the format `generate-outline` specifies (quoted strings, `levels` in objective order). The body is two or three sentences to the learner: what the module covers and which decisions in their feature it prepares them for.

## 5. Finish

Reply with one line: the slug, and that the module is ready to generate (the app starts it on its own; from a terminal, `/generate-module <slug> <module-id>`).
