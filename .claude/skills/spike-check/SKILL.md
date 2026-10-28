---
name: spike-check
description: Phase 0 smoke test — proves a headless run can invoke a skill, spawn a subagent, and write a file.
argument-hint: "<topic>"
allowed-tools: "Read,Write,Agent"
disable-model-invocation: true
---

This is a smoke test. Do exactly these three steps and nothing else.

1. Use the `spike-researcher` subagent with this instruction: "Give three one-sentence facts about: $ARGUMENTS". Wait for its report.
2. Write the report to `spike/out/result.md` with a `# Spike: $ARGUMENTS` heading, the three facts as a list, and a final line `Written by: spike-check skill`.
3. Reply with the single line: `SPIKE OK — wrote spike/out/result.md`.
