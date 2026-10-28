# Evidence-based learning techniques for an AI-generated course + tutor

Research brief for the personal AI course system (lesson generator + quiz generator + chat tutor). Each section gives: the evidence and its strength (Dunlosky et al. 2013 utility rating where the technique was covered there), a concrete design recommendation for our content format or tutoring loop, and sources. Priorities and prompt-level rules are at the end.

Dunlosky et al. (2013) ratings, for reference: **High** = practice testing, distributed practice. **Moderate** = elaborative interrogation, self-explanation, interleaved practice. **Low** = summarization, highlighting, keyword mnemonic, imagery for text, rereading. Note that "low" for summarization means *low as a stand-alone student study habit with no feedback*; summarization with expert feedback (what our end-of-module summary + Socratic chat does) is a different intervention and is better supported (see §3 and §9). Source: [Dunlosky, Rawson, Marsh, Nathan & Willingham 2013, PSPI](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html); full PDF via [stafforini mirror](https://stafforini.com/works/dunlosky-2013-improving-students-learning/).

---

## 1. Retrieval practice / testing effect

**Evidence strength: High (Dunlosky). Three large meta-analyses agree.**

- Adesope, Trevisan & Sundararajan 2017 (RER): practice testing beats restudy and every other comparison; g ≈ 0.50–0.61. [PDF](https://education.wsu.edu/documents/2018/01/rethinking-use-tests.pdf/)
- Yang, Luo, Vadillo, Yu & Shanks 2021 (Psych Bulletin): 222 classroom studies, 48,478 students, g = 0.499. Effect moderated by corrective feedback, number of test repetitions, format consistency between practice and criterion test. [PDF](https://gwern.net/docs/spacedrepetition/2021-yang.pdf)
- Carpenter, Pan & Butler 2022 (Nature Reviews Psychology): 100-year synthesis of spacing + retrieval in applied settings. [PDF](https://www.teachertoolkit.co.uk/wp-content/uploads/2022/10/s44159-022-00089-1.pdf)

**Question format: MC vs short-answer vs free recall.**
- Kang, McDermott & Roediger 2007: *without* feedback, MC quizzes beat short-answer (SA) because SA produces more unfed errors; *with* feedback, SA beats MC. Conclusion: "regular SA quizzes with feedback" are the best practical format. [PDF](https://www.gwern.net/docs/spaced-repetition/2007-kang.pdf)
- Smith & Karpicke 2014: SA, MC and hybrid (SA then MC) all beat restudy at one week on both verbatim and inference questions; hybrid gave little extra benefit. [PDF](https://learninglab.psych.purdue.edu/downloads/2014/2014_Smith_Karpicke_Memory.pdf)
- Little, Bjork, Bjork & Angello 2012; Little & Bjork 2014: MC items are good *if distractors are competitive* (plausible, previously-studied alternatives); then students retrieve knowledge about the wrong alternatives too and later recall of *untested* related facts improves. Non-competitive distractors give no such benefit. [PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2017/01/LittleBjorkMC2014.pdf)

**Feedback timing and content.**
- Butler, Karpicke & Roediger 2007: delayed feedback on MC beat immediate feedback on a final test (delay acts as a spaced re-exposure); "answer-until-correct" vs "show correct answer" did not differ. [Abstract](https://profiles.wustl.edu/en/publications/the-effect-of-type-and-timing-of-feedback-on-learning-from-multip/)
- Butler, Godbole & Marsh 2013: explanation feedback = correct-answer feedback on repeated questions, but explanation feedback is *better for transfer* to new questions. [Abstract](https://scholars.duke.edu/publication/746629)
- Wisniewski, Zierer & Hattie 2020 meta-analysis (435 studies): feedback d = 0.48 overall; effect driven by *information content* (what to do next), not praise. [Paper](https://www.frontiersin.org/articles/10.3389/fpsyg.2019.03087/full)
- Hypercorrection: high-confidence errors are *more* likely to be corrected after feedback (Butterfield & Metcalfe 2001), so surfacing the learner's confidence before feedback is worth doing. [Review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4036076)

**Design recommendations**
1. Keep end-of-section checks but make the default format **short-answer with mandatory feedback**, with MC used (a) when the point is discriminating among plausible confusions, and (b) only with competitive distractors generated from known misconceptions or neighbouring concepts in the same module.
2. Every check gets **explanation feedback**, not just "correct/incorrect + answer": one or two sentences on *why* the right answer is right and why the learner's wrong answer is tempting.
3. **Feedback timing**: immediate feedback for SA/open answers (errors need correcting before they consolidate); for an MC batch, show results after the batch, not per-item, and re-ask missed items at the end of the module (delayed feedback + spacing).
4. **Frequency**: at least one retrieval event per section and a cumulative mini-quiz per module. Yang 2021 found more repetitions help; successive relearning (§2) implies each item should be successfully recalled ~3 times across sessions before being "retired."
5. Match format to the criterion: if the goal is to be able to explain and apply, the practice checks must be explain/apply questions, not recognition.

---

## 2. Spaced repetition and interleaving

**Evidence strength: Spacing = High (Dunlosky). Interleaving = Moderate (Dunlosky), with a solid meta-analysis and one large RCT since.**

- Cepeda, Vul, Rohrer, Wixted & Pashler 2008: optimal gap between study and review grows with the retention interval; roughly 20–40% of a 1-week retention interval, falling to 5–10% of a 1-year interval. [PDF](https://www.evullab.org/pdf/CepedaVulRohrerWixtedPashler-PS-2008.pdf)
- Rawson & Dunlosky 2011, "successive relearning": retrieve each item to criterion (one correct recall) in session 1, then relearn to criterion in ~3 spaced later sessions. Dramatically better retention per minute than massed study. [Lab publication list](https://www.kent.edu/psychology/comprehension-memory-lab/rawsons-comprehension-memory-lab-publications); applied chapter [here](https://openscholarship.wustl.edu/circle_book/8)
- Brunmair & Richter 2019 meta-analysis of interleaving: g = 0.42 over 59 studies; the benefit is largest when interleaved items are *similar and confusable* (discriminative contrast). [PDF](https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf)
- Rohrer, Dedrick, Hartwig & Cheung 2020 RCT (787 students): interleaved math worksheets 61% vs 38% on a delayed test, d = 0.83; meets WWC standards. [IES record](https://ies.ed.gov/ncee/wwc/Study/88770)
- Bjork & Bjork 2011, "desirable difficulties": spacing, interleaving, variation and testing all *lower performance during practice* while raising long-term learning; this is why learners (and naive content generators) avoid them. [PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf)
- Soderstrom & Bjork 2015: learning ≠ performance; in-session accuracy is an unreliable index of durable learning. [PDF](https://hwb.gov.wales/api/storage/1031b700-acaf-4eda-a4bc-758715e85ff2/Learning%20versus%20Performance%20An%20Integrative%20Review.pdf)

**Scheduling algorithm.** FSRS (Jarrett Ye, open-spaced-repetition) models memory with three components (difficulty, stability, retrievability) and is fit per-learner; on the community benchmark of ~10k Anki collections it beats SM-2 for ~99% of users, with retention RMSE 5.3% vs 16.2%, and needs ~30–50% fewer reviews for the same retention. Anki adopted it. [Anki FAQ](https://faqs.ankiweb.net/what-spaced-repetition-algorithm); [FSRS vs SM-2 summary](https://www.mindomax.com/fsrs-vs-sm2-spaced-repetition-algorithm). SM-2 is fine as a fallback and trivially simple; FSRS is the better choice if you store per-item review history anyway.

**Design recommendations**
1. **Yes, pull earlier-module items into later modules.** Each module quiz should be ~70% current module, ~30% review items drawn by the scheduler from earlier modules, with priority to items the learner got wrong or rated low-confidence.
2. Represent every learning objective / key concept as a schedulable item with a review history; run FSRS (or SM-2 initially) over them. Target retention ~90%. A due item surfaces as a one-question "warm-up" at the start of the next lesson (this is also Rosenshine's "begin with review").
3. **Successive relearning rule**: an item is "learned" only after 3 correct spaced recalls; the tutor can tell the learner this explicitly to defuse the "I already know this" objection.
4. **Interleave confusable concepts** inside a quiz (e.g. the three mechanisms a module distinguishes should appear as mixed questions, not blocked by mechanism), and have the generator produce "which of these is it?" discrimination items whenever a module introduces two or more similar ideas.
5. Tell the learner, once, that in-quiz difficulty is intended; otherwise the spaced/interleaved quizzes feel like the system is being unfair (Bjork's point that desirable difficulties are experienced as undesirable).

---

## 3. Elaborative interrogation, self-explanation, and the Feynman technique

**Evidence strength: Elaborative interrogation = Moderate; self-explanation = Moderate (Dunlosky); self-explanation meta-analysis g = 0.55; teaching/preparing-to-teach g = 0.35–0.56.**

- Elaborative interrogation ("why would that be true?"): Pressley, McDaniel, Turnure, Wood & Ahmad 1987 is the founding study; works best for *facts* with some prior knowledge, and the effect depends on the learner generating a plausible, precise explanation. [Abstract](https://profiles.wustl.edu/en/publications/generation-and-precision-of-elaboration-effects-on-intentional-an/)
- Self-explanation: Bisra, Liu, Nesbit, Salimi & Winne 2018 meta-analysis, 64 studies, g = 0.55, holds when time-on-task is controlled; works for both conceptual and procedural knowledge. [PDF](https://www.Gwern.net/doc/psychology/spaced-repetition/2018-bisra.pdf); [BPS digest](https://bps.org.uk/research-digest/self-explanation-powerful-learning-technique-according-meta-analysis-64-studies)
- Caveat from Barbieri et al. 2023 (worked-example meta-analysis): tacking generic self-explanation prompts onto worked examples *reduced* performance in that literature. Prompts need to be targeted (explain *this* step, *why this* condition) and not pile load on novices. [UDel summary](https://cehd.udel.edu/?p=30127)
- Feynman technique has no primary research under that name; the evidence base is "learning by teaching." Kobayashi 2019 meta-analysis: preparing-to-teach g = 0.35; actually teaching (after preparing) g = 0.56; larger when the teaching is *interactive* (the "student" asks questions). [Frontiers follow-up](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1095285/pdf); [MetaTOC entry](https://metatoc.com/papers/112234-learning-by-preparing-to-teach-and-teaching-a-meta-analysis)
- Fiorella & Mayer 2016, "Eight ways to promote generative learning": summarizing, mapping, drawing, imagining, self-testing, self-explaining, teaching, enacting. Summarizing *does* work when learners are trained and get feedback; that is the difference from Dunlosky's "low." [Overview](https://www.umpi.edu/ctl/?p=5173)
- ICAP (Chi & Wylie 2014): learning increases Passive < Active < Constructive < Interactive. Explaining to a tutor that pushes back is "Interactive," the top mode. [PDF](https://csi.asu.edu/wp-content/uploads/2018/01/ChiWylie2014ICAP.pdf)

**Design recommendations**
1. In-lesson prose should include at most one **"Why?" prompt per section** targeted at a non-obvious causal claim ("Why would X cause Y rather than Z?"). The learner writes 1–3 sentences; the tutor grades for a *precise* explanation and supplies the missing mechanism if the learner's answer is vague.
2. The end-of-module written summary is good; make it a **"teach it" task**: "Explain this module to a smart colleague who has never seen it, in your own words, with one worked example." Then the Socratic chat plays the *interactive student*: asks clarifying questions, requests an example, probes an edge case. That is exactly the condition with the biggest effect in Kobayashi.
3. Tutor response rules for explanations: (a) identify which required idea units the explanation contains and which are missing (Dunlosky & Rawson's idea-unit scoring, §8); (b) never rewrite the learner's explanation for them; (c) ask for the missing piece with a question, then confirm or correct.
4. Do not attach generic "explain each step" prompts to every worked example; use them selectively on steps that embody the principle.

---

## 4. Generation effect and pretesting

**Evidence strength: Generation effect meta-analysis d = 0.40 (86 studies). Pretesting is well replicated and, in direct comparisons, competitive with or better than post-testing.**

- Bertsch, Pesta, Wiscott & McDaniel 2007 meta-analysis: generating vs reading, d = 0.40. [PubMed](https://pubmed.ncbi.nlm.nih.gov/17645161/)
- Richland, Kornell & Kao 2009: unsuccessful retrieval attempts before reading improved later recall of the pretested material. [PDF](https://learninglab.uchicago.edu/Pre-Testing_files/RichlandKornellKao.pdf); Kornell, Hays & Bjork 2009 showed the same with items designed so no one could answer. [UChicago pretesting page](https://learninglab.uchicago.edu/Pre-Testing.html)
- Pan & Sana 2021 (JEP, 5 experiments, N = 1,573): pretesting > posttesting at 5 min and 48 h, in MC and cued-recall formats, with and without feedback. [Abstract](https://pure.athabascau.ca/en/publications/pretesting-versus-posttesting-comparing-the-pedagogical-benefits-/)
- Little & Bjork 2016: **MC pretests potentiate learning of related, non-pretested information** when alternatives are plausible. Directly relevant to the baseline diagnostic. [Psychonomic Society summary](https://featuredcontent.psychonomic.org/old-faithful-but-not-el-capitan-multiple-choice-pretesting-helps-learning-about-cronartium-ribicola/)
- Productive failure (Sinha & Kapur 2021 meta-analysis, 53 studies, 166 comparisons): problem-solving *before* instruction beats instruction-then-practice for conceptual understanding; effect is strongest when the activity is designed to surface multiple student solutions and the subsequent instruction explicitly contrasts them with the canonical solution. [WEF summary](https://www.weforum.org/stories/2021/09/students-who-productively-fail-learn-more/); [French meta-analysis PDF](https://rire.ctreq.qc.ca/wp-content/uploads/sites/2/2023/01/Meta-analyse.pdf)
- Pretesting also reduces mind-wandering during subsequent lectures (Pan & colleagues). [Pan profile](https://fass.nus.edu.sg/psy/people/steven-pan)

**Design recommendations**
1. Keep the baseline diagnostic, but **design it as a learning event, not just a placement test**: cover the course's core objectives with MC items whose distractors are the real misconceptions, so the test itself primes later learning. Tell the learner that being wrong is expected and useful.
2. Add a **per-section "predict first" prompt** (one question, 20–60 seconds) before the explanatory prose: "Before reading: what do you think happens when ...?" The prose then explicitly refers back ("Most people predict X; it is actually Y because ..."). This is the productive-failure structure in miniature and is cheap to generate.
3. For procedural/problem-solving modules, open with a **short problem the learner probably cannot fully solve**, collect their attempt, and have the lesson's instruction contrast the learner's attempt with the canonical approach (Kapur's "consolidation" phase). The tutor should name what was right in the attempt.
4. Feedback on pretest answers can be deferred to the lesson itself; the lesson is the feedback.

---

## 5. Worked examples, faded examples, and the expertise reversal effect

**Evidence strength: worked-example effect robust for novices (meta-analysis 55 studies, ~18 percentile points); expertise reversal well replicated.**

- Barbieri, Miller-Cotto, Clerjuste & Chawla 2023 meta-analysis (math): studying worked examples beats problem solving for novices; correct examples > incorrect examples overall; generic self-explanation prompts hurt. [UDel summary](https://cehd.udel.edu/?p=30127); [poster PDF](https://www.cehd.udel.edu/wp-content/uploads/2022/02/Worked-Examples-Meta-Poster_022722_SC.pdf)
- Renkl & Atkinson 2003: fade worked steps progressively (complete example → partially completed → full problem) to bridge from example study to independent solving. [Abstract](https://asu.elsevierpure.com/en/publications/structuring-the-transition-from-example-study-to-problem-solving--2)
- Kalyuga, Ayres, Chandler & Sweller 2003, expertise reversal: guidance and worked examples that help novices become redundant or harmful for learners with relevant schemas; experts learn more from problem solving. [UOW record](https://ro.uow.edu.au/edupapers/136); [Wikipedia summary](https://en.wikipedia.org/wiki/Expertise_reversal_effect)
- McNamara, Kintsch, Songer & Kintsch 1996: the text analogue. Low-knowledge readers need highly coherent, explicit text; high-knowledge readers learn *more* from less coherent text that forces inference. [Springer record](https://link.springer.com/article/10.1007/BF03172992)
- Fyfe, McNeil, Son & Goldstone 2014, concreteness fading: start concrete, fade to abstract representation. [Summary](https://learningscientists.org/blog/2018/2/1-1)

**Design recommendations**
1. Use the baseline diagnostic to assign a **per-objective level (novice / intermediate / proficient)**, not one course-wide level. Content generator reads the level for each section's objective.
2. Novice: full worked example first, then a faded example (last step missing), then a full problem. Intermediate: one faded example, then problems. Proficient: problem first, worked solution only on request (expertise reversal: skip the scaffolding).
3. For prose, the same dial: novice gets explicit connectives and restated referents ("this pressure difference, the gradient from §2, ..."); proficient gets terser text with gaps the learner is expected to bridge, plus a "Why?" prompt at the gap.
4. Concreteness fading: open each new abstraction with a concrete instance, then the general statement, then the symbolic/formal form; later references use the formal form.
5. Re-estimate level per objective from quiz and Socratic-chat performance and move the dial; this is the one place "adaptive" is clearly justified by evidence.

---

## 6. Socratic / tutoring dialogue and LLM tutors

**Evidence strength: human tutoring d ≈ 0.79 and step-based ITS d ≈ 0.76 (VanLehn), not Bloom's 2σ. The 2024–2026 LLM literature is mixed: strong gains when the tutor is pedagogically constrained; harm or nothing when it gives answers; engagement collapse when Socratic constraints are applied to unmotivated learners.**

Baselines
- Bloom 1984, "The 2 Sigma Problem": tutoring + mastery learning, 2 SD. [PDF](https://Www.Gwern.net/doc/psychology/1984-bloom.pdf)
- VanLehn 2011: across 1975–2010 studies, human tutoring d = 0.79, step-based ITS d = 0.76, answer-based systems d = 0.31. The 2σ figure does not replicate; the practical gap between a good ITS and a human tutor is small. [MIT symposium slides](https://quality.mit.edu/files/2012/01/Quality-Symposium-Kurt-VanLehn.pdf)

Positive LLM-tutor findings
- Kestin, Miller, Klales, Milbourne & Ponti 2025 (Scientific Reports, RCT, N = 194, Harvard physics): a custom AI tutor built on the same pedagogy as the active-learning class (one idea at a time, retrieval, hints before answers, prompts to think first) produced roughly double the learning gains of in-class active learning, in less time, with higher engagement. [Paper (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/); [Harvard Gazette](https://news.harvard.edu/gazette/story/2024/09/professor-tailored-ai-tutor-to-physics-course-engagement-doubled/)
- Bastani et al. 2025 (PNAS, field RCT, ~1,000 high-school math students): "GPT Base" (vanilla ChatGPT) raised practice scores 48% but students then scored **17% worse than controls** on the unassisted exam. "GPT Tutor" (prompted to give hints, not answers, and to withhold solutions) raised practice scores 127% and **removed the harm** (no significant difference from controls on the exam). [SSRN](https://papers.ssrn.com/abstract=4895486); [Stanford SCALE summary](https://scale.stanford.edu/ai/repository/generative-ai-can-harm-learning)
- Wang, Ribeiro, Robinson, Loeb & Demszky 2024, Tutor CoPilot (RCT, 900 tutors, 1,800 students): AI that coaches *tutors* toward "ask guiding questions, don't give away the answer" raised mastery 4 pp overall, 9 pp for weaker tutors. [arXiv](https://arxiv.org/abs/2410.03017)
- World Bank Nigeria 2025 (RCT, 800 students, 6 weeks, Copilot/GPT-4 with teacher supervision): +0.31 SD overall, +0.23 SD English. [World Bank](https://openknowledge.worldbank.org/entities/publication/15e1ff08-15ae-4f7a-b2a8-d146e6c113ee/full)
- Google LearnLM 2024: "pedagogical instruction following"; experts preferred a model trained to follow explicit pedagogy instructions (manage load, promote active learning, adapt, stimulate curiosity, deepen metacognition) over GPT-4o by 31%. Useful as a vocabulary for our tutor prompt. [arXiv](https://arxiv.org/abs/2412.16429v1)
- Reflective-dialogue vs prompt-refinement tutor (2026, robotics course, 66 students): Socratic-guidance tutor gave higher learning gains in later sessions and better independent LLM use afterward, though learners found it less efficient. [arXiv](https://arxiv.org/abs/2607.03303)

Negative / null findings
- Lehmann, Cornelius & Sting 2024–25, "AI meets the classroom": LLM use helps when students use it as a tutor (ask for explanations) and hurts when they offload the exercises; students with stronger prior knowledge gain more; LLM access **inflates perceived learning beyond actual learning**. [arXiv](https://arxiv.org/abs/2409.09047v2)
- Oreopoulos & Low 2026 (NBER w35620, Khanmigo, 2-year cluster RCT, 18 Tennessee middle schools): +0.06–0.08 SD per year, no benefit beyond plain Khan Academy practice. 96% tried it; the typical student messaged it on a third of practice days and in only 17% of sessions with errors; messages were mostly bare answers or suggested-prompt clicks. Students wanted answers and abandoned the Socratic tutor. [NBER](https://www.nber.org/papers/w35620); [KQED write-up](https://www.kqed.org/mindshift/66662/students-didnt-get-answers-from-khanmigo-they-didnt-want-its-questions-either)
- "To Tell or to Ask" (SIGCSE TS 2026, RCT, 178 CS1 students): Socratic hints increased time, attempts and repeat errors in the short term with **no long-term benefit** over targeted hints. [SIGCSE](https://sigcse2026.sigcse.org/details/sigcse-ts-2026-posters/161/To-Tell-or-to-Ask-Comparing-the-Effects-of-Targeted-vs-Socratic-AI-Hints)
- Nie et al. 2024, "The GPT Surprise" (massive coding class): offering GPT-4 chat *reduced* overall engagement/completion but adopters scored higher on exams; selection effects likely. [NSF record](https://par.nsf.gov/servlets/purl/10583650)
- Kosmyna et al. 2025 (MIT, N = 54, EEG, essay writing): LLM group showed lower neural connectivity, weaker recall and ownership of their own essays across sessions ("cognitive debt"). Small, preprint, not a tutoring study, but a plausible mechanism for over-reliance. [arXiv](https://arxiv.org/abs/2506.08872v1)
- Lee et al. (Microsoft Research / CMU) CHI 2025 survey of 319 knowledge workers: higher confidence in GenAI predicts *less* critical thinking; higher self-confidence predicts more. [PDF](https://advait.org/files/lee_2025_ai_critical_thinking_survey.pdf)
- **Caution on the headline meta-analysis**: Wang & Fan 2025 (g = 0.867 for ChatGPT on learning) was **retracted** on 22 April 2026 for pooling incommensurable studies; do not cite it. [404 Media](https://www.404media.co/nature-retracts-paper-on-the-benefits-of-chatgpt-in-education/)

**What distinguishes the tutors that worked**
- Kestin tutor and Bastani's GPT Tutor: explicit system prompts to withhold the final answer, give one step at a time, ask the learner to try first, keep cognitive load low, and *still be useful* (GPT Tutor gave strong hints, not riddles).
- Tutor CoPilot: concrete expert moves ("ask a guiding question," "prompt the student to explain their reasoning," "revoice") rather than abstract "be Socratic."
- Khanmigo's failure was motivational, not pedagogical: remedial middle-schoolers in a compulsory setting. A self-chosen personal course with a motivated adult is a very different population; still, build the *explicit* understanding that the tutor won't just hand over answers and why.

**Design recommendations**
1. Tutor prompt should implement a **hint ladder**: (1) ask the learner what they have tried / what they think; (2) point to the relevant principle or the lesson section; (3) give the next step only; (4) give a worked solution *of a parallel problem*; (5) full solution with the learner required to then solve a near-transfer variant. Never jump to (5) without the learner having attempted (1)–(3).
2. Make the answer-withholding **transparent and bounded**: "I'll give you a step at a time; say 'show me' if you're stuck and I'll show a parallel example." The SIGCSE finding suggests pure question-only Socratic hints can be wasteful; targeted hints with a required attempt beat open-ended "what do you think?" loops.
3. For the end-of-module Socratic chat: the tutor's job is to (a) find gaps in the learner's summary against the module's objective list, (b) ask for a counterexample or edge case, (c) present a *plausible-sounding wrong claim* and see if the learner catches it, (d) ask the learner to apply the idea to a new case. Cap at ~5 exchanges, then produce the "understanding summary."
4. Track **answer-seeking behaviour**: if the learner repeatedly asks for the solution without attempts, the tutor should say so and switch to a faded-example instead of a full answer.
5. After any tutor-assisted solve, require an **unassisted near-transfer item** before marking the objective met (counters Bastani's crutch effect and Lehmann's inflated perceived learning).

---

## 7. Concept maps, dual coding, and multimedia

**Evidence strength: concept maps g = 0.58 (constructing 0.72 > studying 0.43); Mayer's coherence/signaling/segmenting principles supported in dozens of experiments; seductive details g = −0.33. Dual coding theory is well established but "imagery for text" rated Low by Dunlosky.**

- Schroeder, Nesbit, Anguiano & Adesope 2018 meta-analysis, 142 effects: concept maps g = 0.58; *constructing* g = 0.72, *studying* g = 0.43. [SFU record](https://summit.sfu.ca/item/17789)
- Mayer, Cambridge Handbook of Multimedia Learning: coherence (exclude extraneous material; 23/23 tests, median d = 0.86), signaling (cue the organization; 24/28, d = 0.41), redundancy, segmenting (learner-paced chunks), spatial/temporal contiguity, personalization (conversational style; 10/10, median d ≈ 1.3). [Cambridge chapter](https://resolve-he.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning-coherence-signaling-redundancy-spatial-contiguity-and-temporal-contiguity-principles/CD5B7AE1279A9AB81F8EEBB53DBEC86E); [12-principles summary](https://services.dartmouth.edu/TDClient/1806/Portal/KB/PrintArticle?ID=171655)
- Sundararajan & Adesope 2020, seductive details meta-analysis, 58 studies: g = −0.33; worse when the detail sits next to a relevant diagram or is persistent on screen. [WSU record](https://rex.libraries.wsu.edu/esploro/outputs/journalArticle/Keep-it-Coherent-A-Meta-Analysis-of/99900601155501842)
- Clark & Paivio 1991, dual coding theory and education. [PDF](https://clark.faculty.uwinnipeg.ca/Clark/Publications/1991-Clark&Paivio-DCT&Educ.pdf)

**When a diagram helps vs is noise**
- Helps: when it carries *structure the prose would otherwise have to serialize* (processes, hierarchies, comparisons, spatial/temporal relations), when it is referenced from the text at the point of use, when labels are on the figure (contiguity), and when it is stripped to the elements the point needs (coherence).
- Noise: decorative images, stock illustrations, diagrams of things already clear from one sentence, anything with more than ~7 nodes for a novice, charts that restate a table, and "interesting but irrelevant" asides (seductive details).

**Design recommendations**
1. The generator may produce a diagram only when it can state, in metadata, which relationship the diagram shows that prose cannot show as well. Default is no figure.
2. Prefer simple SVG/Mermaid structure diagrams (flow, hierarchy, 2×2 contrasts, timelines) over pictures. Label on the figure, reference it in the sentence that needs it.
3. **Learner-constructed maps beat supplied maps**: at module end, optionally ask the learner to list the module's 5–8 key concepts and the relationships between them (text is fine); the tutor compares against its own map and probes missing links. This is a cheap "constructive" (ICAP) activity.
4. Segmenting: one idea per section; sections short enough that the end-of-section check comes within a few minutes of reading.
5. Signaling: headings that state the claim, bold on the term being defined, a one-line "the point" at the top of each section.

---

## 8. Metacognition and calibration

**Evidence strength: well established that learners are overconfident and that overconfidence lowers achievement; delayed judgments of learning are far more accurate than immediate ones; hypercorrection is robust.**

- Dunlosky & Rawson 2012, "Overconfidence produces underachievement": students who over-scored their own answers stopped practising too early and retained less; the fix that worked was **idea-unit scoring** (show the learner the required idea units and have them check which their answer contains). [Kent State profile](https://www.kent.edu/psychology/profile/john-dunlosky)
- Nelson & Dunlosky 1991, delayed-JOL effect: judgments of learning made after a delay (and after a retrieval attempt) are nearly accurate; immediate judgments are poor. [Psych Science index](https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.1992.tb00680.x/)
- Butterfield & Metcalfe 2001 and successors: high-confidence errors are corrected *more* after feedback. [Review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4036076)
- Gardner-Medwin, certainty-based marking: rate certainty 1–3; scoring 1/2/3 for correct, 0/−2/−6 for wrong; encourages justification and reflection; most useful formatively. [Physoc summary](https://www.physoc.org/?p=64978); [Moodle implementation](https://docs.moodle.org/36/en/Using_certainty-based_marking)
- Soderstrom & Bjork 2015 (above): in-session fluency misleads the learner; Lehmann et al. 2024 (above): LLM access inflates perceived learning.

**Design recommendations**
1. **Confidence rating on every check** (3-point: guess / fairly sure / certain), captured *before* feedback. Use it for (a) hypercorrection framing in feedback ("you were certain, and this is a common trap because..."), (b) scheduler priority (certain-and-wrong items are the highest-priority review items; guessed-and-right are next), (c) a per-module calibration score shown to the learner.
2. **Delayed JOL**: at the end of a module, before the summary task, ask the learner to predict how well they will do on next week's review (0–100%), then show the actual result when it happens. Calibration improves with this feedback loop.
3. **Idea-unit self-scoring for open answers**: show the learner the 2–4 idea units the model answer contains and have them tick which their answer included; the tutor then confirms. This both improves calibration and reduces the AI's grading burden.
4. The "understanding summary" per module should include a calibration line ("Learner was overconfident on X, underconfident on Y") that later modules' generators read: overconfident areas get a predict-first prompt and a contrasting-case item.

---

## 9. Writing and prose guidance for instructional text

**Evidence strength: coherence/seductive-details effects are strong; conversational style (personalization) is strong in Mayer's studies; the main caution is McNamara's interaction with prior knowledge.**

- Coherence principle and seductive details (§7): cut everything not needed for the objective; g = −0.33 for added "interesting" material.
- Personalization principle: conversational style ("you," "we," direct address) beats formal style, median d ≈ 1.3 across 10 tests; the mechanism is social agency, not informality for its own sake. [Mayer, Fennell, Farmer & Campbell 2004 via Cambridge handbook](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-of-multimedia-learning-based-on-social-cues-personalization-voice-and-image-principles/19309D764FD015A556334531A463DE03)
- McNamara et al. 1996: for low-knowledge readers, *maximize* coherence (explicit connectives, restated referents, filled-in inferences); for high-knowledge readers, a less coherent text that forces inference produces better situation-model understanding. "Professor voice" should therefore scale with level.
- Rosenshine 2012: small steps, models, many questions, high success rate (~80% during guided practice), scaffolds, weekly/monthly review. [PDF](https://www.aft.org/sites/default/files/periodicals/Rosenshine.pdf)
- Concreteness fading (§5): concrete example before abstract statement.
- Elaborative interrogation (§3): a "why" question in the text is a legitimate device; a rhetorical flourish is not.

**Design recommendations**
1. "Concise professor voice" means: *claim first, then mechanism, then one concrete example, then the boundary condition.* No anecdotes, no history unless the history is the content, no jokes, no "interestingly."
2. Second person, active voice, short declarative sentences; the "professor" addresses the learner directly (personalization), not an audience.
3. Each section opens with a one-line statement of what the learner will be able to do (the objective, in Bloom verb form) and closes with the check that measures it.
4. Coherence dial by level: novices get explicit connectives ("because," "which means," "unlike §2's case"), term restated rather than pronominalized; proficient learners get tighter text with a deliberate gap + "why?" prompt.
5. Define a term once, at first use, in bold; reuse the identical term thereafter (no elegant variation).
6. Cap: aim for ~150–350 words per section between checks (segmenting), one idea per section.

---

## 10. Module and course structuring

**Evidence strength: these are design frameworks rather than effect-size literatures; they organize the techniques above and are well regarded.**

- Revised Bloom's taxonomy (Anderson & Krathwohl 2001; Krathwohl 2002 overview): remember → understand → apply → analyze → evaluate → create; crossed with knowledge types (factual, conceptual, procedural, metacognitive). Its main practical value is **congruence**: objective, activity and assessment at the same level. [Krathwohl 2002 (EdTech Hub copy)](https://docs.edtechhub.org/lib/NANNVKS6)
- Wiggins & McTighe, Understanding by Design, backward design: (1) identify desired results, (2) determine acceptable evidence, (3) plan learning experiences. [Yale Poorvu summary](https://poorvucenter.yale.edu/print/3786); [UVM CTL](https://www.uvm.edu/ctl/backward-design-and-learning-objectives)
- Meyer & Land 2003, threshold concepts: transformative, irreversible, integrative, bounded, troublesome. These are the concepts that deserve productive-failure openings, more retrieval reps and dedicated Socratic time. [ETL Report 4 PDF](https://pressbooks.atlanticoer-relatlantique.ca/app/uploads/sites/803/2021/07/ETLreport4.pdf)
- Rosenshine (above): begin with review; small steps; weekly and monthly review.
- Bloom 1984 mastery learning: the other half of the 2σ result was mastery learning (formative test → corrective → re-test before moving on), which alone was ~1σ in Bloom's data.

**Design recommendations**
1. **Objective is the unit.** The outline generator produces, per module, 3–6 objectives each written as "Learner can <Bloom verb> <content> <condition>", tagged with Bloom level and knowledge type. Every check, every scheduler item and every "understanding summary" line keys to an objective ID.
2. **Backward design in the pipeline**: generate objectives → generate the end-of-module assessment (summary prompt + Socratic probes + transfer items) → *then* generate sections and in-section checks. This guarantees the checks measure the objectives rather than whatever the prose happened to say.
3. **Flag threshold concepts** in the outline (the generator is asked: "which 1–3 concepts in this course are transformative and troublesome?"). Those get: predict-first/productive-failure opening, extra retrieval items, a counterexample probe in the Socratic chat, and mandatory review in the next two modules.
4. **Order within a module** by Bloom level and by prerequisite: remember/understand items before apply, apply before analyze/evaluate; but do not leave a module at "remember." Every module should end at apply or higher.
5. **Mastery gate**: the understanding summary records which objectives were met (≥ 2 correct unassisted retrievals including one transfer item). Unmet objectives are carried forward into the next module's warm-up and must be re-checked; the next module's generator receives the list.
6. Use the diagnostic to *prune* and *reorder*: objectives the learner already demonstrates at apply level are compressed to a review item; weak prerequisites get an inserted mini-section.

---

## Prioritized build list (top 10)

1. **Objective-keyed backward design** (§10): objectives → assessment → prose. Everything else hangs on objective IDs.
2. **Short-answer retrieval checks with explanation feedback** every section, MC only with competitive distractors (§1).
3. **Spaced review items pulled from earlier modules into every later quiz**, scheduled by FSRS (or SM-2 first), with the successive-relearning "3 correct spaced recalls" criterion (§2).
4. **Confidence rating before feedback + hypercorrection framing + calibration feed into the scheduler and the understanding summary** (§8).
5. **Hint-ladder tutor prompt with answer-withholding and a required unassisted transfer item after any assisted solve** (§6, Bastani/Kestin pattern).
6. **Predict-first prompt per section and a learning-oriented baseline diagnostic with misconception distractors** (§4).
7. **End-of-module "teach it" summary + interactive Socratic student** (clarify, counterexample, catch a planted wrong claim, apply to new case), capped at ~5 exchanges, producing the understanding summary (§3, §6).
8. **Per-objective level dial driving worked → faded → problem sequencing and prose coherence** (§5, §9).
9. **Interleaved discrimination items whenever a module introduces confusable concepts** (§2).
10. **Coherence/seductive-details discipline and the "diagram only with a stated structural reason" rule** (§7, §9).

Deferred (lower evidence or lower value per effort): learner-built concept maps, delayed-JOL prediction loop, elaborate adaptive text-coherence rewriting.

---

## Prompt-level rules for the lesson-generating agent

**Structure**
- Begin every lesson with a one-item review of a due earlier-module objective (scheduler supplies it).
- One objective per section; state it in the first line as "After this section you can <Bloom verb> ...".
- Section length 150–350 words between checks. One idea per section.
- Open each section with a predict-first question (one sentence, answerable in under a minute) when the section introduces a mechanism, rule, or counterintuitive result; otherwise skip it.
- Order: claim → mechanism → one concrete example → boundary condition / common confusion → check.
- Concrete before abstract; introduce the formal/symbolic form after the concrete instance, then use the formal form.
- End each module at Bloom "apply" or higher; never end at "remember."

**Prose**
- Second person, active voice, declarative sentences. Address the learner directly.
- No anecdotes, history, jokes, or "interesting asides" unless they are the objective (seductive details rule). No "interestingly," "note that," "it is worth mentioning."
- Define each term once, in bold, at first use; reuse the identical term; no synonyms for defined terms.
- Novice level (from diagnostic): explicit connectives, restate referents, fill in inferences. Proficient level: tighter prose, leave one inferential gap per section and mark it with a "Why?" prompt.
- Diagrams only when the metadata field `diagram_reason` names a relationship (process, hierarchy, contrast, spatial/temporal) that prose would serialize badly. Labels on the figure; reference it from the sentence that needs it. No decorative images.

**Checks**
- At least one check per section; default format short-answer; MC only when discriminating plausible confusions, with distractors drawn from the module's listed misconceptions or neighbouring concepts.
- Every check carries: objective ID, Bloom level, model answer as 2–4 idea units, explanation feedback (why right, why the tempting wrong answer is wrong), and a near-transfer variant for re-testing.
- When a module introduces two or more confusable concepts, generate interleaved "which is it?" items mixing them.
- Module quiz: ~70% current objectives, ~30% scheduler-supplied earlier-module items, in mixed order.
- Collect a 3-point confidence rating before showing feedback.

**End of module**
- Summary task phrased as "Explain this module to a smart colleague who hasn't seen it, with one worked example."
- Socratic chat script for the tutor: (1) identify missing idea units vs the objective list, ask for them; (2) ask for a counterexample or edge case; (3) assert one plausible wrong claim and see if the learner catches it; (4) ask for application to a new case; (5) stop at ~5 exchanges.
- Understanding summary must list: objectives met/unmet (with evidence), calibration notes (over/underconfident areas), confusions observed, threshold concepts still shaky. Next module's generator reads this and inserts a warm-up or mini-section for unmet items.

**Tutor behaviour (chat)**
- Hint ladder: ask what they tried → point to principle/section → next step only → parallel worked example → full solution followed by a required unassisted variant. Do not skip rungs unless the learner has attempted.
- Say explicitly, once per session, that answers are withheld by design and how to get a parallel example.
- If the learner asks for the answer three times without an attempt, name it and switch to a faded example.
- Never mark an objective met from an assisted solve; require an unassisted near-transfer item.
- Feedback content: what was right, what is missing, what to do next; no praise-only responses.
