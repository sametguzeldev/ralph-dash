# RalphDash

A self-hosted web dashboard for monitoring and controlling [Ralph](https://github.com/sametguzeldev/ralph) AI loop iterations across multiple projects. Runs locally via Docker and reads project data directly from the filesystem.

![Dark dashboard UI with Kanban board, live log viewer, and progress timeline](https://placehold.co/900x500/1a1a2e/a78bfa?text=RalphDash)

---

## Features

- **Workflow wizard** — guided 4-step process: generate clarifying questions → write a PRD → convert to `prd.json` → start a Ralph run, all powered by Claude CLI skills
- **Real-time skill output** — streams Claude CLI progress with emoji-annotated tool usage (reads, writes, edits, bash commands) as each skill runs
- **Kanban board** — visualises user stories across Pending / In Progress / Done columns, derived from each project's `prd.json`
- **Live run control** — start and stop `ralph-cc.sh` runs from the dashboard; tail output in real time
- **In-app file editor** — view and edit workflow files (questions, PRDs, prd.json) without leaving the dashboard
- **Follow-up questions** — iteratively deepen requirements by generating follow-up questions from answered responses
- **Progress timeline** — parsed from `progress.txt`, shows iteration history with learnings
- **Run history / archives** — browse completed runs stored under `scripts/ralph/archive/`
- **Multi-workspace support** — mount as many project directories as you need via `docker-compose.override.yml`
- **File sync** — copies Ralph skills and scripts into a project on add or manual sync
- **Docker Claude authentication** — configure an API key or OAuth token in Settings so the containerized Claude CLI can run skills
- **Delete with confirmation** — type-to-confirm modal; stops active runs automatically before removal

---

## Requirements

- [Docker](https://www.docker.com/) and Docker Compose
- A [Ralph](https://github.com/sametguzeldev/ralph) installation on the host machine
- A Claude authentication token (API key or OAuth token) — configured in Settings after first launch

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/sametguzeldev/ralph-dash.git
cd ralph-dash
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set your Ralph installation path:

```env
RALPH_PATH=/Users/you/PersonalProjects/ralph
```

### 3. Configure workspace mounts

RalphDash needs to access your project directories inside the container at the same absolute path as on the host.

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
```

Edit `docker-compose.override.yml` to mount each directory that contains your projects:

```yaml
services:
  ralph-dash:
    volumes:
      - /Users/you/PersonalProjects:/Users/you/PersonalProjects
      - /Users/you/WorkProjects:/Users/you/WorkProjects
```

### 4. Run

```bash
docker compose up --build
```

Open [http://localhost:5625](http://localhost:5625) in your browser.

---

## First-time Setup

1. Go to **Settings** and confirm your Ralph installation path is correct. Hit **Save** — this validates the path and makes file sync available.
2. **(Docker only)** In the **Claude Authentication** section, paste your token:
   - **OAuth token** — run `claude setup-token` on your host machine to get an `sk-ant-oat...` token (uses your Claude Pro/Max subscription)
   - **API key** — get an `sk-ant-api...` key from [console.anthropic.com](https://console.anthropic.com) (pay-per-use)
3. Go to **Projects** and click **Add Project**.
4. Enter a display name and the absolute path to your project root (tilde `~` is supported).
5. RalphDash will copy the Ralph skills into your project automatically.
6. Click the project card to open its dashboard. Use the **Workflow** wizard to generate requirements and start a run.

---

## Project Structure

```
ralph-dash/
├── backend/                  # Express + TypeScript API
│   └── src/
│       ├── db/               # SQLite schema and connection (better-sqlite3)
│       ├── routes/           # projects, runner, settings, workflow
│       └── services/         # fileParser, fileCopier, processManager,
│                             #   skillRunner, workflowDetector
├── frontend/                 # React + Vite + TypeScript
│   └── src/
│       ├── components/       # KanbanBoard, LogViewer, ProgressTimeline,
│       │                     #   RunHistory, DeleteConfirmModal, Sidebar,
│       │                     #   WorkflowWizard, FileEditor, WizardStepIndicator
│       ├── pages/            # Dashboard, Projects, Settings
│       └── lib/api.ts        # Typed fetch wrapper
├── .env.example
├── docker-compose.yml
├── docker-compose.override.example.yml
└── Dockerfile                # Multi-stage build (frontend → backend → final)
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Get settings (includes `isDocker`, `claudeConfigured`) |
| `PUT` | `/api/settings` | Update Ralph path |
| `PUT` | `/api/settings/claude-token` | Save Claude auth token |
| `DELETE` | `/api/settings/claude-token` | Remove Claude auth token |
| `GET` | `/api/projects` | List all projects (with live status) |
| `POST` | `/api/projects` | Add a new project |
| `DELETE` | `/api/projects/:id` | Remove a project (stops active run) |
| `POST` | `/api/projects/:id/sync` | Re-copy Ralph files into a project |
| `GET` | `/api/projects/:id/status` | Full project status (PRD + progress + branch) |
| `GET` | `/api/projects/:id/archives` | List completed run archives |
| `GET` | `/api/projects/:id/archives/:folder` | Get a specific archive detail |
| `POST` | `/api/projects/:id/run/start` | Start a Ralph run |
| `POST` | `/api/projects/:id/run/stop` | Stop the active run |
| `GET` | `/api/projects/:id/run/status` | Get run status and PID |
| `GET` | `/api/projects/:id/run/output` | Poll run output (supports `?since=N`) |
| `GET` | `/api/projects/:id/workflow/status` | Workflow step + skill status |
| `GET` | `/api/projects/:id/workflow/files` | List workflow files (questions, PRDs) |
| `GET` | `/api/projects/:id/workflow/file` | Read a workflow file (`?path=...`) |
| `PUT` | `/api/projects/:id/workflow/file` | Save a workflow file |
| `DELETE` | `/api/projects/:id/workflow/file` | Delete a workflow file (`?path=...`) |
| `POST` | `/api/projects/:id/workflow/skill/start` | Start a Claude skill run |
| `POST` | `/api/projects/:id/workflow/skill/stop` | Stop running skill |
| `GET` | `/api/projects/:id/workflow/skill/status` | Get skill run status |
| `GET` | `/api/projects/:id/workflow/skill/output` | Poll skill output (`?since=N`) |
| `POST` | `/api/projects/:id/workflow/prd-json/validate` | Validate prd.json content |

---

## File Conventions

RalphDash expects the following files inside each project root:

| File | Purpose |
|------|---------|
| `scripts/ralph/prd.json` | User stories, task status (`passes`, `inProgress`) |
| `scripts/ralph/progress.txt` | Append-only iteration log |
| `scripts/ralph/.last-branch` | Current branch name written by Ralph |
| `scripts/ralph/ralph-cc.sh` | Run script (copied from Ralph installation) |
| `scripts/ralph/archive/` | Completed run archives (auto-managed by Ralph) |

### Task status derivation

| Condition | Status |
|-----------|--------|
| `passes: true` | Done |
| `inProgress: true` and `passes: false` | In Progress |
| Neither | Pending |

---

## Development

No root-level `package.json` — run commands from the respective subdirectory.

### Backend

```bash
cd backend
npm install
npm run dev      # tsx watch mode, http://localhost:3001
npm run build    # compile TypeScript to dist/
```

### Frontend

```bash
cd frontend
npm install
npm run dev      # Vite dev server, http://localhost:5173
                 # proxies /api/* to :3001 automatically
npm run build
```

### Docker

```bash
docker compose up --build   # production build, http://localhost:5625
docker compose down
```

---

## Architecture Notes

- **Database** — SQLite in WAL mode via `better-sqlite3`. Schema is auto-created on startup. The DB file lives at `data/ralph-dash.db` (mounted as a Docker volume).
- **Process management** — runs are spawned as detached bash processes. Output is buffered (last 500 lines) and served via long-polling with an absolute line counter, so the log viewer survives buffer rotation.
- **Skill runner** — spawns `claude -p` with `--output-format stream-json --verbose` to execute skills. Stream-json events are parsed in real time into human-readable progress messages. The `CLAUDECODE` env var is stripped to avoid nested-session detection.
- **Workflow detection** — `workflowDetector` scans the project's `tasks/` directory for `prd-questions-*.md` and `prd-*.md` files and determines which workflow step the project is on.
- **Docker authentication** — when `RALPH_DOCKER=1` is set, Settings exposes a Claude token input. Tokens are stored in SQLite and injected as `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` when spawning skills.
- **Frontend state** — TanStack React Query; the projects list and dashboard refetch every 3–5 seconds automatically. Skill output uses plain `setInterval` polling to avoid query-key caching conflicts.
- **Security** — workflow file paths are validated against an allowlist (`tasks/`, `scripts/ralph/prd.json`) and resolved against the project root to prevent path traversal. The container runs as the `node` user (non-root).
