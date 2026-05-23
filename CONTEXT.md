# Context — ralph-dash

Glossary of domain terms used in this codebase. Implementation details belong in code; decisions belong in `docs/adr/`.

## Project

A directory on the host filesystem that contains a `scripts/ralph/` folder. ralph-dash tracks one row per Project in the DB, keyed by absolute path. A Project has an assigned Provider and (optionally) a model variant.

## Provider

A named AI backend (`claude`, `codex`, `opencode`). Each Provider knows how to run the long-lived loop *and* how to run one-shot skills for a Project. Today only the loop path is fully Provider-aware; the skill path is hardcoded to `claude` (see open work in `/tmp/ralph-dash-handoff-codex-skills.md`).

## Run

A child process that ralph-dash has spawned on behalf of a Project. Two kinds today:

- **Loop run** — long-lived. Spawns the Provider's `runnerScript` (e.g. `ralph-cc.sh`, `ralph-codex.sh`) which iterates over user stories in `prd.json` until stopped. Started via `POST /api/projects/:id/run/start`.
- **Skill run** — one-shot. Invokes a Provider with a single skill (`prd-questions`, `prd`, or `ralph`) to produce a file artifact (`prd-questions-*.md`, `prd-*.md`, `prd.json`). Started via `POST /api/projects/:id/workflow/skill/start`.

Skill runs produce the inputs a Loop run consumes. They are conceptually sequential: **a Project should have at most one Run of either kind active at any time.** (The code does not enforce this today — see candidate #1 of the 2026-05-23 architecture review.)

## Skill

A named, Provider-agnostic prep operation. Each Skill knows how to turn UI parameters into a free-text prompt; it does not know which Provider will execute it. The three Skills today:

- `prd-questions` — generate clarifying questions for a feature description, or follow-ups for an answered questions file
- `prd` — turn an answered questions file into a PRD markdown
- `ralph` — turn a PRD markdown into `prd.json`

Skills compose with Providers: a route handler asks a Skill for the prompt, then asks a Provider to describe how to execute it. The Provider materializes the Skill's on-disk content (e.g. Claude reads `.claude/skills/<skill>/SKILL.md`; Codex inlines from its own location) and produces a RunSpec.

## RunSpec

A complete description of one process invocation: `{kind, skillName?, command, args, cwd, env, parseLine}`. Produced by a Provider (`describeLoop` / `describeSkill`), consumed by ProcessRun.

## ProcessRun

The single module that owns the plumbing of a Run: spawning the child, partial-line buffering, ring-buffer of ≤500 parsed lines, status/output polling, SIGTERM, and the at-most-one-Run-per-Project invariant. Kind-agnostic — it consumes whatever RunSpec it's given.

## Workflow step

Derived state describing where a Project is in the prep cascade before its Loop can run. Evaluated in order: `prd-json-ready` → `prd-created` → `questions-answered` → `questions-created` → `no-files`. Computed purely from file presence under `scripts/ralph/` and `tasks/`.
