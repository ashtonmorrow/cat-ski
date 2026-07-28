---
name: arch-review
description: Whole-codebase architecture audit. Finds AI-generated spaghetti — duplication, needless abstraction, mixed responsibilities, leaky boundaries, dead code — and returns a prioritized, diffable findings report with a phased refactor plan. Use when auditing a repo's structure and reuse, not when reviewing a single diff or branch (use /code-review for that). Read-only: never refactors.
source: qa-kit@8a51f983
edit: changes here are overwritten — edit qa-kit/skills/ instead
---

# Architecture Review

A structural audit of an entire codebase. Produces findings, not commits.

## Hard rules

1. **Do not refactor.** No edits, no "while I was here" fixes. The deliverable is the report. If you catch yourself opening an editor, stop.
2. **Every finding carries evidence.** A `file:line` anchor and a concrete cost or failure scenario. "This looks duplicated" is not a finding. "`parseToken` in `lib/auth.ts:40` and `apps/api/token.ts:12` differ only in error branch; a fix to one silently misses the other" is.
3. **Respect prior decisions.** If `.qa/decisions.md` exists — that exact path, not any directory that happens to be named `qa` — read it first. Anything adjudicated there does not get re-raised; note it as settled and move on. A repo's own `qa/` or `docs/qa/` is unrelated and often holds test records rather than decisions; do not treat it as this file.
4. **Budget forces ranking.** Cap at 8 P1 and 12 P2. If you have more, they are not all P1. Cutting to the budget *is* the prioritization work — do not pad the report to look thorough.

## Step 0 — Reconcile with the repo

Run this before the skill's own work, once, at the start. Its output is a short
statement in chat of which rules govern this run.

### Read the instruction-bearing files

Not the whole repo — the skill's own phases handle reading code. Just these:

- `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`
- `.claude/skills/*/SKILL.md` other than this one
- `CONTRIBUTING.md`, and any `docs/` style or convention guide
- Enforced config: `.editorconfig`, ESLint/Biome, Ruff/Flake8, Prettier,
  `tsconfig.json` strictness, pre-commit hooks
- `.qa/decisions.md` if present

### Facts outrank method; method outranks preference

The distinction that keeps this cheap: **the repo is authoritative about
itself, the skill is authoritative about how to work.**

Stack, build and test commands, architecture constraints, domain rules,
deployment shape — the skill has no opinion on any of it. That is not conflict,
it is the input the skill needs. Load it and use it. Only a narrow band of
things genuinely collide, and only that band gets reported.

Precedence, highest first:

1. **What the user says in this conversation.** Always wins, no exception. A
   correction mid-run re-governs the rest of the run.
2. **Machine-enforced config.** A lint rule, a formatter, a compiler flag.
   Not preferences — code violating them fails CI, so they are facts.
3. **This skill.** Method: how to scope, how to rank, what the output is.
4. **Repo prose conventions.** `CLAUDE.md` style guidance, `CONTRIBUTING.md`,
   comment and commit norms written as prose.

**A passing gate is a finished part of the audit.** Where a repo *proves* a
property — a dependency-cruiser ruleset, a layer-boundary script, a strict
compiler flag, an architecture test — that property holds. Re-deriving it by
hand burns the run and risks reporting a finding the gate already disproves.
Name the gate, state what it covers, and skip that ground.

The converse matters more. Gates are usually scoped to a path — `eslint src`,
an `include` list, a test dir — and whatever falls outside has been accumulating
without a safety net, often for as long as the project has existed. Establish
each gate's *scope*, not just its existence, and give ungated code the scrutiny
the gate would have given it. Ranking by file size alone will point at the
largest code, which in a healthy repo is usually the best-defended; risk per
line is highest where nothing is checking.

Rule 3 over rule 4 is deliberate: the skill exists so the method is the same
everywhere. A repo saying "document every function" and the skill saying
"minimal comments" is a real conflict, and the skill wins **unless the user
says otherwise** — which is exactly why it must be surfaced rather than
silently resolved.

### Report before starting

State it in chat, not in a file. Keep it to the collisions.

```
**Governing this run** — qa-kit@<version>

Read: CLAUDE.md, .eslintrc.json, CONTRIBUTING.md

Conflicts:
- Comment density: CLAUDE.md wants a docblock per export; this skill treats
  narration as a finding. Following the skill. Say "keep the docblocks" to flip.

Deferring to the repo on: stack (Next.js + Supabase), test command
(`npm test`), the no-`/admin` architecture rule.
```

With nothing in conflict, one line: `No conflicts — following qa-kit@<version>
plus the repo's own conventions.`

Then start. Do not wait for approval; the default is stated and the user can
redirect at any point.

### When to stop instead

If a repo convention contradicts the skill's *purpose* rather than its method —
the repo forbids the thing the skill exists to do — say so and ask. That is not
a precedence question, and guessing wastes a full run.

## Phase 1 — Scope before reading

Never open files at random on a large repo; you will exhaust context before reaching the parts that matter. Build a map first.

1. Read manifests and entry points: `package.json`, `pyproject.toml`, `requirements*.txt`, `tsconfig.json`, `next.config.*`, `main.*`, `index.*`, `app/`.
2. Get the tree, pruning vendored trees: `node_modules`, `.venv`, `dist`, `build`, `vendor`, `.git`.
3. Write down the **intended** layers before judging the actual ones. UI / domain / data access / infrastructure — what does the structure claim to be? You are measuring drift from that claim.
4. Rank files by size. Spaghetti concentrates in two places: the largest files, and anything named `utils`, `helpers`, `lib`, `common`, `shared`, or `misc`. Read those first.

Only after the map do you deep-read suspects.

## Phase 2 — Hunt

Seven categories. Each has an ID prefix used in the report.

| Prefix | Category | Looking for |
|---|---|---|
| `DUP` | Duplication | Near-identical functions, components, types, or constants. Copy-paste with one branch changed. Parallel type definitions of the same shape. |
| `ABS` | Needless abstraction | Wrappers that only forward. Single-implementation interfaces. Config objects passed to one call site. Files under ~20 lines that exist only to re-export. Barrel files that obscure the dependency graph. |
| `COH` | Mixed responsibility | Functions or components doing fetching *and* transforming *and* rendering. A "manager" or "service" that is really four unrelated jobs sharing a filename. |
| `CON` | Inconsistency | The same operation done three ways. Mixed error handling (throw here, return `null` there, error tuple elsewhere). Mixed async idioms. Naming that varies for identical concepts. |
| `DEAD` | Dead weight | Unused exports, unreachable branches, obsolete compatibility shims, feature flags for shipped features, commented-out blocks. |
| `BND` | Boundary leak | SQL or fetch calls inside components. Domain rules inside route handlers. Infrastructure types crossing into UI. Circular imports. Modules importing more than ~15 siblings. |
| `REUSE` | Missed reuse | New helper written when an existing one needed one parameter. Business rule reimplemented per call site instead of living in one module. |

Useful sweeps (adapt to the stack):

```bash
# duplicate exported symbol names (JS/TS)
rg -o 'export (?:async )?function (\w+)' -r '$1' --no-filename | sort | uniq -d

# duplicate top-level defs (Python)
rg -o '^def (\w+)' -r '$1' --no-filename | sort | uniq -d

# re-export-only barrels
rg -l '^export .* from' --glob '*.ts' | xargs wc -l | awk '$1 < 20'

# candidate dead exports: exported once, referenced nowhere else
# (verify each by hand — dynamic imports and framework conventions defeat this)
```

Treat sweep output as *candidates*. A grep hit is not a finding until you have read both sites.

## Phase 3 — Verify

Before a finding goes in the report, try to kill it:

- Is the duplication actually divergent on purpose? Two things that look alike but answer to different owners should stay apart.
- Is the abstraction load-bearing for a test seam, a platform difference, or a published API?
- Is the "dead" export consumed dynamically, by a framework convention, or by an external consumer?
- Would the recommended refactor create worse coupling than it removes?

Findings that survive this go in. Findings that do not, do not get a "possibly" hedge — they get dropped.

## Severity rubric

Apply the test, not intuition. This is what makes runs comparable.

**P1 — Urgent architectural.** Makes a likely near-term change dangerous or expensive, *or* carries correctness risk today. Test: *"If someone ships a normal feature next week, does this cause a bug or a multi-day detour?"* Divergent duplicates of a business rule qualify. An ugly-but-isolated file does not.

**P2 — Worthwhile cleanup.** Real, measurable cost. Contained blast radius. No correctness risk. Test: *"Does this cost time on every visit to this area?"*

**P3 — Taste.** Defensible either way. No measurable cost. Test: *"Would two good engineers disagree?"* If yes, it is P3. List these as one-liners with no recommendations attached.

## Output format

Stable, so runs diff against each other. Finding IDs derive from **content**, never position, so an ID survives the file moving.

```
ARCH-<PREFIX>-<kebab-slug>
```

Example: `ARCH-DUP-token-parse`, `ARCH-BND-sql-in-components`.

Report structure:

```markdown
# Architecture Review — <repo> — <date>

## Verdict
<Three sentences: overall maintainability, the single biggest structural risk,
and whether the intended layering is holding.>

## Scorecard
| Dimension | Rating | Note |
|---|---|---|
| Layer clarity | Strong / Holding / Drifting / Absent | |
| Reuse | ... | |
| Consistency | ... | |
| Dead weight | ... | |

## P1 — Urgent
### ARCH-DUP-token-parse
**Where:** `lib/auth.ts:40`, `apps/api/token.ts:12`
**Problem:** <what is wrong>
**Cost:** <the concrete failure or expense>
**Refactor:** <specific action, named destination>
**Effort:** S / M / L

## P2 — Worthwhile
<same shape>

## P3 — Taste
- `ARCH-CON-import-order` — one line each, no recommendation.

## Settled (not re-raised)
<only if .qa/decisions.md exists — list IDs and the prior call>

## Phased plan
**Phase 1 — Stop the bleeding.** <P1s that unblock the others, in order>
**Phase 2 — Consolidate.** <the reuse and duplication work>
**Phase 3 — Opportunistic.** <touch-when-nearby>

Sequencing note: <what must precede what, and why>
```

## Ending the run

Close by stating what you did **not** cover — directories skipped, sampling used, anything the budget cut. A review that hides its own gaps reads as complete when it is not.
