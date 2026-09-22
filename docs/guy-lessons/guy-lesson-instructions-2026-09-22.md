# GUY LESSON INSTRUCTIONS — 22 Sep 2026

=== FILE: Project custom instructions (שיעורי גיא) ===

Difficulty Register Protocol: Every chat in this project has access to the Hebrew Difficulty Register (project knowledge file). When building flashcard apps, study guides, or lesson materials from tutoring session PDFs or notes:
Scan vocabulary and grammar items against the six difficulty categories in the Register
Prioritize items that stack across multiple categories (e.g., a Nif'al verb that governs a non-English preposition)
Flag known difficulty areas on individual cards/items with explicit notes
Include 1-2 contextual conjugation drills per lesson, selecting verbs from the source material — favor Nif'al and phonologically irregular roots
Always note governed prepositions on verbs, especially when they diverge from English
When a vocabulary item has a letter-order confusable or homophonous spelling issue, note the pair explicitly

=== FILE: Hebrew_Lesson_Tools.md ===

# Hebrew Lesson Tools

Build vocabulary flashcard apps and study guides from tutoring session PDFs and notes, with difficulty-aware vocabulary selection and contextual drilling.

## Source: Tutoring Session PDFs & Notes

1. Dan uploads PDF or images from lessons with tutor Guy ("Daniel" in lesson materials is Dan)
2. Transcribe and organize the content
3. Identify grammar topics, vocabulary, example sentences, and exercises
4. Extract vocabulary → flashcard app + lesson study guide

## Difficulty Register Integration

**Read the Hebrew Difficulty Register (project knowledge file) before selecting vocabulary and building drills.** This is the most important step — it transforms generic vocabulary extraction into targeted practice.

### Selection Protocol

When choosing which vocabulary items to include and which verbs to drill:

1. **Scan all candidate items** against the six difficulty categories (see Register for full definitions):
   - Verb conjugation production (Nif'al priority, phonological deviations)
   - Prepositional government
   - Letter-order confusables
   - Homophonous letter spelling (ח/כ, א/ע)
   - Construction mismatches
   - Idiomatic equivalents

2. **Prioritize items that stack** across multiple categories. A Nif'al verb that governs a non-English preposition and has a guttural root is worth more than three clean Pa'al verbs.

3. **Select 1-2 verbs for contextual conjugation drilling** per lesson. Favor:
   - Nif'al over other binyanim when available
   - Roots with phonological deviations (gutturals, dagesh rejection, nun assimilation, sibilant metathesis) over clean roots
   - Verbs that also hit category 2 (prepositional government)

### Flagging Protocol

On individual flashcard items, add explicit notes for:
- **Governed preposition** on every verb, with ⚠️ flag when it diverges from English
- **Confusable pair** when a letter-order twin exists (show both words, make the distinction visible)
- **Spelling alert** when homophonous letters (ח/כ, א/ע, ט/ת) could cause confusion
- **Construction note** when the Hebrew structure differs meaningfully from English
- **Idiom flag** when an expression uses different imagery than the English equivalent

### Conjugation Drill Format

For the 1-2 selected verbs, include in the study guide:
- Full conjugation table (past, present, future, imperative where relevant)
- 3-4 production exercises: sentence with blank, subject gives person/number cue
- Note any phonological deviations from the vanilla binyan template
- If Nif'al: explicitly compare with the Pa'al form of the same root

## Vocabulary Extraction

Extract 25-50 items per lesson across categories:
- **Nouns & Terms**: Domain-specific vocabulary from lesson content
- **Verbs**: With binyan identification and governed preposition
- **Expressions**: Idioms and collocations from lesson examples
- **Grammar patterns**: Structures and rules covered in the session

### Data Format

Use array-of-arrays for flashcard data. Each item is one array with fields in this order:

```
[0]  Hebrew with nikud
[1]  Hebrew without nikud
[2]  Transliteration (kept in data for accessibility, not displayed by default)
[3]  English meaning
[4]  Root (dotted: א.ב.ג)
[5]  Binyan (or "" if not a verb)
[6]  Category
[7]  Part of speech
[8]  Example sentence (Hebrew)
[9]  Example translation (English)
[10] Notes (linguistic notes, difficulty flags, confusables, preposition alerts)
```

### Notes Field: Difficulty Flag Conventions

| Flag | Category | Usage |
|------|----------|-------|
| ⚠️ Prep: | Prepositional government | `⚠️ Prep: נלחם ב- (fights IN, not 'against')` |
| ⚠️ Confusable: | Letter-order confusable | `⚠️ Confusable: להתבייש (ashamed, ב.ו.ש) vs להתיבש (dry out, י.ב.ש)` |
| ⚠️ Spelling: | Homophonous letters | `⚠️ Spelling: ends with ח not כ — remember the root is ש.ל.ח` |
| ⚠️ Construction: | Construction mismatch | `⚠️ Construction: "talking on the phone" = לנהל שיחת טלפון` |
| ⚠️ Idiom: | Idiomatic equivalent | `⚠️ Idiom: Hebrew says "who against whom" where English says "up from down"` |

## Flashcard App Technical Specs

**CRITICAL: Use vanilla HTML/JS only.** No React, no JSX, no Babel. Artifact preview stalls on large JSX files. Use innerHTML rendering with array-of-arrays data.

### Required Features
- **Nikud toggle**: Switch between pointed/unpointed Hebrew
- **Category filter**: Filter by topic domain
- **Progress tracking**: Card count and "known" marking
- **Card flip**: Tap/click to reveal meaning
- **Linguistic notes**: Expandable section per card (difficulty flags live here)
- **Mobile-optimized**: Touch-friendly, responsive layout
- **RTL handling**: Hebrew text always `dir="rtl"`

### Color Theme

Lessons cover mixed topics. Assign each vocabulary category its own accent color so cards are visually distinguishable when filtering. Use a neutral `#f8fafc` background.

### Size Management

- Target: under 15KB total file size
- 35 cards is a comfortable maximum per app
- If vocabulary exceeds 35 items, split into two apps or prioritize items using the Difficulty Register
- Validate: count data entries before finalizing, confirm count matches expected

## Study Guide Format

```markdown
# שיעור עם גיא — [Date]
## Lesson Topics: [Grammar topics covered]

## [Grammar Topic 1]
[Explanation with examples from the lesson]
[Include non-technical explanation suitable for sharing with Guy]

## [Grammar Topic 2]
[Explanation with examples]

## תרגילי הטיה — Conjugation Drills
[1-2 verbs from the lesson, per Difficulty Register protocol]

## מילים מרכזיות — Core Vocabulary
[Table: Hebrew | English | Root | Binyan | Category]

## שאלות הבנה — Comprehension Questions
[In Hebrew, based on lesson content]

## ביטויים חשובים — Key Expressions
[With usage notes and difficulty flags]
```

## Output Files

For each lesson, produce two files:
1. `lesson-[date]-flashcards.html` — Vanilla HTML/JS flashcard app
2. `lesson-[date]-study-guide.md` — Grammar and vocabulary companion

Save to `/mnt/user-data/outputs/` and present to user.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|--------------|--------------|------------------|
| Using React/JSX/Babel | Artifact preview stalls on large JSX files | Vanilla HTML/JS with innerHTML rendering |
| Selecting only clean/regular verbs for drills | Misses the conjugation production gap — Dan already knows regular patterns | Deliberately select irregular roots, gutturals, Nif'al |
| Noting preposition without comparing to English | Dan's error source is English transfer — he needs to see the mismatch | Always show: Hebrew prep vs. what English would use |
| Building conjugation drills as separate hour-long sessions | No contextual anchor, lower retention | Embed 1-2 verb drills in the lesson, tied to lesson content |
| Including 50+ cards in one app | Exceeds preview rendering capacity | Cap at 35, prioritize via Difficulty Register |
| Ignoring Guy's teaching structure | Lesson already has pedagogical logic; overriding it loses value | Preserve Guy's topic organization, layer difficulty awareness on top |

## What This Tool Does NOT Do

- Article extraction and online news study (separate project: Hebrew Study)
- Standalone drill generation from the Difficulty Register (future)
- Root deep-dive lessons (use the ק.ב.ל template workflow)
- Borrowed verbs project work (separate existing workflow)
- General Hebrew conversation practice

=== FILE: Hebrew_Difficulty_Register.md ===

# Hebrew Difficulty Register

## Purpose
Persistent log of Dan's known Hebrew weak areas, ranked by priority. Consult this when building study materials (flashcard apps, lesson guides, article study tools) and when designing standalone drills.

## Design Principle: Stack for Density
When selecting verbs, phrases, or constructions to drill from source material, **prioritize items that hit multiple categories simultaneously**. Categories 1 and 2 pair naturally (conjugation + preposition in one sentence). Categories 3 and 4 layer in when the right roots are available. A single well-chosen example reinforcing 2-3 categories is worth more than three separate exercises hitting one each. The contextual anchor from the source material (article, lesson with Guy) provides the memory hook — stacking multiplies its value.

## Difficulty Categories (Priority Order)

### 1. Verb Conjugation Production
**The problem:** Comprehension and binyan identification are strong. Producing correct conjugated forms across all tenses and all binyanim on the fly is not. This is the biggest gap between Dan's passive and active Hebrew.

**How to address in study materials:** When building a lesson or study guide, select 1-2 verbs from the source material and include a brief conjugation drill — table + a few production exercises. The source context (article topic, lesson discussion) provides the memory anchor. Don't isolate conjugation into hour-long paradigm sessions; embed it contextually.

**Sub-priorities:**
- **1a. Nif'al** — Weakest binyan. When choosing which verb from the source material to drill, favor Nif'al over other binyanim when available.
- **1b. Phonological deviations** — Roots where gutturals, dagesh chazak rejection, nun assimilation, or sibilant metathesis cause conjugation patterns to deviate from the "vanilla" template for that binyan. Deliberately select these roots over clean/regular ones when drilling.

### 2. Prepositional Government
**The problem:** Hebrew verbs and adjectives govern specific prepositions that frequently don't match the English equivalent. Dan's instinct is to translate from English, producing the wrong preposition.

**Examples:**
- לפחד **מ-** (to fear *from*) — English: afraid *of*
- לתקוף **ב-** (to attack *in*) — English: attack ∅
- לחכות **ל-** (to wait *to*) — English: wait *for*

**How to address:** When a verb appears in study material, always note its governed preposition. Flag it explicitly when the Hebrew preposition diverges from English. In drills, present the verb with a blank for the preposition, not just the conjugation.

### 3. Letter-Order Confusables
**The problem:** Verb and noun pairs where transposing consonants produces a different real word with a different root and meaning. Primarily a production/recall problem — in context Dan can parse the right reading, but when producing, the two compete.

**Key example:**
- להתבייש (to be ashamed, ב.ו.ש) vs להתיבש (to dry out, י.ב.ש)

**How to address:** When a new vocabulary item has a common confusable partner, note both together explicitly. Drill them as pairs — present both, make the distinction visible, reinforce which is which.

### 4. Homophonous Letter Spelling
**The problem:** In modern Israeli pronunciation, ח/כ are identical and א/ע are both silent (also ט/ת, כ/ק, ש/ס to varying degrees). Words learned by ear carry no cue for which letter is correct. This is an orthographic memory problem, not a phonology problem.

**How to address:** When a vocabulary item contains a homophonous pair, flag the spelling explicitly. In flashcard apps, the root display already helps (showing the actual letters), but production drills should test spelling — "write the root" or "which letter?" exercises.

### 5. Construction Mismatches
**The problem:** Hebrew uses a structurally different verb, verbal noun, or construction for everyday actions that English handles with a simpler structure. Includes cases where English uses one verb across contexts but Hebrew requires a different verb per noun.

**Examples:**
- "Talking on the phone" → לנהל שיחת טלפון (not מדבר על הטלפון)
- "Make a friend" → לעשות חבר, but "make a connection" → ליצור קשר

**How to address:** When study material contains a Hebrew construction that maps poorly to English, present the Hebrew construction as the primary form with a note that the English equivalent is structurally different. In drills, give the English action and ask for the Hebrew construction — not word-by-word translation.

### 6. Idiomatic Equivalents
**The problem:** Same concept, different metaphor or mental image. These can't be constructed on the fly from English — they must be recalled as stored units.

**Examples:**
- English "before you know up from down" → Hebrew לפני שאתה יודע מי נגד מי (before you know who's against whom)

**How to address:** Collect these as pairs when they surface in lessons or articles. They're inherently a recall/exposure problem — the more Dan encounters them in real context, the more they stick. Flag them in study guides but don't over-drill; repeated natural exposure is more effective than rote practice for idioms.

---

## Specific Items Log
*Add specific items as they surface in lessons and articles. Format: the item, which category it belongs to, source context, date.*

*(Empty — to be populated during study sessions)*

=== FILE: hebrew-thinking-on-paper.md ===

# Hebrew Thinking on Paper Protocol

## Purpose
Persistent instruction for how to integrate Remarkable-based handwriting work into Hebrew study outputs (article lessons and tutor session materials). Sits alongside the Hebrew Difficulty Register and the hebrew-study-tools skill. Both this protocol and the Register should be consulted when building any study guide.

## The Principle
This is Sung-style "thinking on paper" — generative, non-linear, relational. The purpose of the page is to externalize cognitive structure during encoding, not to produce a clean artifact. Copying a conjugation table off a screen onto paper is the anti-pattern. Drawing a root outward to its derivatives and sketching the semantic shifts between them is the pattern.

Three properties make a prompt legitimate under this protocol:

1. **Generative** — the page starts blank-ish and the learner must construct the structure. No transcription.
2. **Relational** — the point is to show connections (root→derivative, binyan→binyan, concept→concept, claim→evidence), not to list items linearly.
3. **Anchored** — each prompt is tied to specific content from the source material (article, lesson), not generic practice.

Messy is fine. The page is scaffolding for thinking, not a deliverable.

## Why This Fits Hebrew Specifically
Hebrew's morphology is radial, not linear. A root spawns a family of words across binyanim and noun patterns with predictable but non-obvious semantic relationships. English-native learners default to list-based study, which obscures exactly the network structure that makes Hebrew coherent. Spatial/relational sketching surfaces the network directly, which is both a comprehension aid and a retention aid.

The Difficulty Register categories also benefit from spatial treatment: preposition government is a relational claim about a verb and its argument; letter-order confusables are a disambiguation problem; construction mismatches are a mapping problem between two languages. All three are easier to encode as diagrams than as flashcard notes.

## Integration with the hebrew-study-tools Skill
Add a new section to every study guide produced by the skill — both the article workflow and the tutor-session workflow. The section lives between the Core Vocabulary table and the Conjugation Drills:

```markdown
## עבודה על נייר — Thinking on Paper
[1-2 generative prompts selected via the protocol below]
```

The flashcard app is unchanged. Nothing in this protocol affects flashcard data structure, size targets, or app format.

## Selection Protocol
Choose **1-2 prompts per study guide**, not more. Overwhelming defeats the point — the learner should spend 10-20 minutes on this, not 90.

Selection priority, in order:

1. **Stack against the Difficulty Register.** If the source material contains a Nif'al verb with a non-English preposition, that's a category 1 + 2 stack — use it. If there's a letter-order confusable pair, use it (category 3). Prefer prompts that exercise two categories at once.
2. **Prefer radial/network prompts over linear ones.** Root radiation maps and binyan fields are stronger than preposition diagrams, which are stronger than argument maps. Go lower down the list only when the source material doesn't support the higher options.
3. **Vary across lessons.** Don't use root radiation every time. Rotate through prompt types so different cognitive moves get exercised.

## Prompt Types

### 1. Root Radiation Map
Pick one root from the source material with rich derivation across the Hebrew lexicon. Put the root at the center. Radiate outward to all derivatives: verbs across binyanim, verbal nouns, agent nouns, abstract nouns, adjectives. Connect them. Annotate where meaning shifts, where metaphor enters, where the semantic field forks.

**Use when:** Source material contains a root with a visible family (e.g., ל.ח.מ → נלחם, מלחמה, לחם, לוחם, להילחם; ק.ב.ל → קיבל, התקבל, מקבל, קבלה, קבלן).

**Stacks with:** Category 1 (binyan production through the derivatives), category 4 (spelling — the shared letters become visible).

### 2. Binyan Field Sketch
Pick one verb from the source material. Sketch the same root in each binyan where it exists. For each, note the meaning shift (active/passive, causative, reflexive, reciprocal, stative). Draw arrows showing how meanings relate across binyanim.

**Use when:** The source material's key verb has a rich binyan spread (e.g., ל.מ.ד → לָמַד, לִמֵּד, הִתְלַמֵּד; כ.ת.ב → כָּתַב, נִכְתַּב, הִתְכַּתֵּב, הִכְתִּיב).

**Stacks with:** Category 1 (especially 1a — forces Nif'al/Hitpa'el production), category 1b when the root is guttural or has assimilation.

### 3. Preposition-Government Map
Pick 2-4 verbs from the source material whose prepositions diverge from English. Lay them out spatially. For each, sketch the verb with its governed object and annotate how the preposition shapes the meaning. Compare explicitly to what English would use.

**Use when:** The source material has multiple verbs with non-English preposition government.

**Stacks with:** Category 2 (direct), category 1 if the verbs are also conjugation-production targets.

### 4. Confusable Pair Disambiguation
When the source material contains a verb or noun with a letter-order twin, sketch both on the page — each with its root, meaning, and an example sentence that clarifies which is which. The goal is to force the distinction into visual memory.

**Use when:** A category 3 item surfaces in the source material.

**Stacks with:** Category 3 (direct), category 4 when the confusable also involves homophonous letters.

### 5. Semantic Cluster Map (article-specific)
For news articles: rather than listing vocabulary, group terms by semantic domain and draw the relationships among them. How does the article's argument move through these clusters? Which terms are the connective tissue?

**Use when:** Article-based study guide with 20+ vocabulary items across multiple semantic fields.

**Stacks with:** Discourse-level comprehension, category 5 (construction mismatches surface when you try to connect clusters).

### 6. Grammar Topic Map (lesson-specific)
For tutor sessions: take one grammar topic Guy/Daniel covered. Map it relationally — not as a rule + examples, but as a network of patterns, exceptions, and connections to adjacent grammar topics. Where does this topic border others? Where do the exceptions live?

**Use when:** Lesson-based study guide where the session covered a discrete grammar topic.

**Stacks with:** Whichever Register category the grammar topic lives in.

### 7. Claim-Evidence Argument Map (article-specific, advanced)
For analytical or opinion articles: map the article's argument structure. Main claim at the top or center, supporting evidence radiating out, caveats and counter-claims as branches. This targets discourse comprehension more than vocabulary, and is most useful for longer pieces or editorials.

**Use when:** The article is argumentative or analytical rather than reportorial, and Dan's comprehension goal is discourse-level (following the writer's reasoning).

**Stacks with:** Professional-register vocabulary, construction mismatches at the sentence level.

## Format in the Study Guide
Each prompt should be phrased as an invitation, anchored to specific source content, and bounded in scope. Template:

```markdown
## עבודה על נייר — Thinking on Paper

Before working through the flashcards, spend 10-20 minutes on one or both of these prompts on the Remarkable. Generative sketching, not copying. Messy is fine.

**1. [Prompt type]: [specific anchor from source]**
[2-3 sentences describing what to sketch and what relationships to surface. Should leave room for Dan's own approach — don't prescribe layout.]

**2. [Prompt type]: [specific anchor from source]**
[Same.]
```

Example (article on Israel's Strait of Hormuz exposure):

```markdown
## עבודה על נייר — Thinking on Paper

**1. Root radiation: ת.ק.פ**
The article uses להתקיף, התקפה, מותקף, and התקפי. Put ת.ק.פ in the center and radiate outward to these and any others you can recall. Where does the meaning stay military, where does it go metaphorical, and what's the throughline?

**2. Preposition-government map: three "attack/affect" verbs**
The article has להתקיף, לפגוע, and להשפיע, each with a different governed preposition (ב-, ב-, על-). Sketch each verb with its object and annotate how the preposition shapes the meaning. Which of these would you get wrong by translating from English?
```

## Anti-Patterns

| Anti-pattern | Why it fails | Correct move |
|---|---|---|
| Prompts that require copying from the study guide | Receptive, not generative — defeats the Sung principle | Prompts that start from a blank page and require construction |
| Prescribing layout or visual structure | Removes the generative work — the learner should choose the spatial logic | Describe relationships to surface; let the learner choose how to draw them |
| Five+ prompts per lesson | Overwhelming; learner skips or skims | Hard cap at 2 prompts per study guide |
| Generic prompts not tied to source content | Fails the anchoring property; no memory hook | Every prompt names specific vocabulary, verbs, or roots from the source |
| Always using the same prompt type | Exercises only one cognitive move | Rotate across the seven types over successive lessons |
| Prompts disconnected from the Difficulty Register | Misses the stacking opportunity | Every prompt selection should name which Register categories it targets |

## Revision Note
If a prompt type proves consistently strong or weak in practice, revise this document rather than working around it. The protocol is expected to evolve as Dan's handwriting practice matures.

=== FILE: Hebrew_Study_Objectives_and_Context.md ===

# Hebrew Study Objectives & Context

## Who This Is For
Dan Shulman — CEO/Founder of Shulman Advisory, a boutique consulting firm focused on Japan-Israel energy and cleantech business.

---

## Why Hebrew

### Personal & Cultural
- Familial connections to Israel
- Cultural heritage and identity
- Direct engagement with Israeli family, friends, and community without linguistic barriers

### Professional
- **Shulman Advisory's core market**: Japan-Israel energy transition, renewable power, cleantech innovation
- Client relationships with Israeli companies and contacts
- Reading Israeli news, technical documents, and industry publications
- Reducing dependence on interpreters for nuanced business discussions

### Intellectual
- Genuine interest in Hebrew as a linguistic system
- Root-based morphology (שורשים) and how meaning constructs across binyanim
- The elegance of Semitic language patterns

---

## Learning Approach

### Root-Centered Study
Hebrew vocabulary is organized around three/four-letter roots. Understanding roots unlocks:
- Networks of related words from single roots
- Predictable meaning shifts across verb patterns
- Deeper retention vs. rote memorization

### Binyan Mastery
Systematic coverage of all seven verb patterns:

| Binyan | Pattern | Function |
|--------|---------|----------|
| פָּעַל | Pa'al | Basic active |
| נִפְעַל | Nif'al | Passive/middle |
| פִּעֵל | Pi'el | Intensive/causative |
| פֻּעַל | Pu'al | Passive of Pi'el |
| הִפְעִיל | Hif'il | Causative |
| הֻפְעַל | Huf'al | Passive of Hif'il |
| הִתְפַּעֵל | Hitpa'el | Reflexive/reciprocal |

**Key insight**: Borrowed/adapted words almost always enter Hebrew through Pi'el, which serves as the standard integration mechanism for foreign terminology.

---

## Skill Targets

| Skill | Objective |
|-------|-----------|
| **Listening** | Israeli news, podcasts, natural conversation, professional discussions |
| **Speaking** | Business meetings, casual conversation, professional presentations |
| **Reading** | News articles, technical documents, professional content |
| **Writing** | Professional correspondence, reports, formal communication |

---

## Vocabulary Domains

Balanced across personal and professional needs:

- **Business & Professional**: Organizational terms, titles, financial vocabulary
- **Technology**: Software, systems, energy sector terminology
- **Energy & Environment**: Renewables, cleantech, sustainability (aligned with Shulman Advisory focus)
- **Everyday Life**: Family, culture, daily interactions
- **Media & Current Events**: News vocabulary, political terms
- **Academic/Formal**: Written register, formal Hebrew

Military/security vocabulary is useful context for understanding Israeli news and general professional competence, but not the primary focus.

---

## Grammar Priorities

- **Irregular verb patterns**: פ"נ, פ"י, ע"ו/י in practical contexts
- **Number-noun agreement**: Quantities, specifications
- **Gender patterns**: Systematic rule acquisition
- **Guttural effects**: Pattern modifications

---

## Progress to Date

### Borrowed Verbs Project
175 verbs across domains demonstrating Hebrew's adaptation of foreign terminology:
- Technology & digital communication
- Business & administration
- Scientific & medical
- Media & communications
- Environmental & energy
- (and others)

### Root Study
Template established with ק.ב.ל root as model for deep root analysis lessons.

### Tools in Use
- **TalkPal**: Speaking practice
- **LingQ**: Vocabulary/content integration
- **Israeli media**: כאן 11, podcasts (אחד ביום, הכותרת, השבוע במזרח התיכון)
- **Claude flashcard apps**: Custom React-based study tools

---

## Study Context

Based in Japan (JST timezone). Study sessions aligned with Israeli broadcast schedules:
- Morning: Israeli evening news/podcasts
- Midday: Vocabulary review, speaking practice
- Evening: Israeli morning shows, deep study

---

## Technical Preferences for Study Tools

- **Mobile-first** (Android) — no external file hosting
- **Nikud toggle** — switch between pointed/unpointed Hebrew
- **Root & binyan display** — linguistic context on every card
- **Origin/etymology** — especially for borrowed words
- **Example sentences** — usage in context
- **Category filtering** — organize by binyan, theme, or domain

---

## What "Success" Looks Like

Professional-level Hebrew enabling:
1. Direct client conversations without interpreters
2. Reading Israeli energy/business news at speed
3. Natural social interaction with Israeli contacts
4. Understanding Hebrew's structure deeply enough to continue learning independently

---

## Using This Document

Reference this in new chats or projects involving:
- Hebrew vocabulary lesson creation
- Flashcard app development
- Root study materials
- Grammar exercises
- Any Hebrew learning tool development

It provides context so Claude can calibrate vocabulary selection, difficulty level, domain focus, and technical implementation to actual objectives.
