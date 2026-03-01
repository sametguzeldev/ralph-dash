# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RalphDash is a full-stack web dashboard for monitoring and controlling Ralph AI loop iterations across multiple projects. It reads project data (prd.json, progress.txt, .last-branch) from the filesystem and presents it as a Kanban board with live run control.

## Development Commands

### Frontend (from `frontend/`)
```bash
npm run dev       # Vite dev server on :5173 (proxies /api to :3001)
npm run build     # TypeScript compile + Vite production build
```

### Backend (from `backend/`)
```bash
npm run dev       # tsx watch mode on :3001
npm run build     # TypeScript compile to dist/
npm start         # Run compiled dist/index.js
```

### Docker
```bash
docker compose up --build    # Build and run (exposed on :5625)
```

No root-level package.json — run npm commands from `frontend/` or `backend/` directories. No test framework is configured.

## Architecture

**Monorepo** with two independent packages (`frontend/`, `backend/`) containerized via a multi-stage Dockerfile.

### Backend (Express + TypeScript)
- **Entry**: `backend/src/index.ts` — Express app setup, serves built frontend static files in production
- **Routes**: `backend/src/routes/` — projects, settings, runner, workflow, models (each an Express Router mounted at `/api/*`)
- **Services**: `backend/src/services/` — fileParser, fileCopier, processManager, skillRunner, workflowDetector
- **Providers**: `backend/src/providers/` — Provider abstraction for AI model backends (see Provider Pattern below)
- **Database**: SQLite via better-sqlite3 in WAL mode (`backend/src/db/`). Schema auto-created on startup with idempotent migrations. DB stored in `data/ralph-dash.db` (gitignored). Configurable via `DATA_DIR` env var.

### Frontend (React + Vite + TypeScript)
- **State**: TanStack React Query for all server state; auto-refetches every 3s on the dashboard
- **API layer**: `frontend/src/lib/api.ts` — typed fetch wrapper with all interfaces and endpoint functions
- **Routing**: React Router v6 — `/projects`, `/projects/:id` (Dashboard), `/models`, `/settings`
- **Styling**: Tailwind CSS with dark theme by default, custom `ralph` purple color palette in `tailwind.config.ts`
- **Responsive**: `useIsMobile()` hook; sidebar hides on mobile, shows as drawer

### Database Schema (3 tables)
- **`settings`**: key-value pairs (e.g., ralphPath)
- **`projects`**: id, name, path (unique), created_at, provider, model_variant
- **`providers`**: id, name (unique), runner_script, is_configured, config (JSON string)

### Provider Abstraction
Providers implement a common interface (`backend/src/providers/types.ts`) with methods: `getEnvVars()`, `getCliArgs()`, `getModelVariants()`, `getAuthConfig()`, `getFilesToSync()`, `parseConfig()`. Currently only Claude is implemented. The registry (`registry.ts`) resolves providers by name. Projects reference a provider by name and a model_variant string. The processManager and skillRunner inject provider-specific env vars and CLI args when spawning processes.

**Token handling**: API keys (`sk-ant-api*`) are stored in the providers table config. OAuth tokens (`sk-ant-oat*`) are written to `~/.claude.json` with `hasCompletedOnboarding: true`.

### Data Flow
- Projects live on the host filesystem. The backend reads `scripts/ralph/prd.json`, `scripts/ralph/progress.txt`, and `.last-branch` from each project's directory.
- Task status is derived: `passes: true` → done, `inProgress: true` (and not passes) → in_progress, else → pending.
- The runner spawns `ralph-cc.sh` as a detached bash process, buffers output (max 500 lines), and serves it via polling. Finished runs kept for 60s TTL.

### Workflow Detection
The workflowDetector checks files in `scripts/ralph/` and `tasks/` to determine the workflow step, evaluated in this cascade: `prd-json-ready` → `prd-created` → `questions-answered` → `questions-created` → `no-files`. File patterns: `prd-questions-*.md`, `prd-*.md`, `prd.json`.

### PRD JSON Schema
```typescript
{
  project: string;
  branchName: string;
  description: string;
  qualityChecks?: Record<string, string>;  // e.g., { "compile": "cd ... && npm run build" }
  userStories: [{
    id: string;           // e.g., "US-001"
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: number;     // 1=highest
    passes: boolean;
    inProgress?: boolean;
    notes: string;
  }]
}
```

Archives are stored in `scripts/ralph/archive/{YYYY-MM-DD}-{featureName}/` folders.

### Docker Volumes
- `RALPH_PATH` — set in `.env`, Ralph source installation, mounted **read-only**
- **Workspace mounts** — configured in `docker-compose.override.yml` (gitignored). Copy `docker-compose.override.example.yml` to get started. Each workspace directory is mounted read-write at the same path.

### File Sync
When adding a project or triggering sync, the backend copies from the Ralph installation into the project: `.claude/skills/` skill files, `scripts/ralph/ralph-cc.sh` (made executable), and `scripts/ralph/CLAUDE.md`. The fileCopier uses the provider's `getFilesToSync()` to determine which files to copy.

## API Endpoints

All routes mounted under `/api/`. Key endpoint groups:

- **Settings**: `GET/PUT /settings`, `PUT/DELETE /settings/git-config`
- **Projects**: `GET/POST /projects`, `GET/DELETE /projects/:id`, `GET /projects/:id/status`, `POST /projects/:id/sync`, `PUT /projects/:id/provider`, `PUT /projects/:id/model-variant`
- **Archives**: `GET /projects/:id/archives`, `GET /projects/:id/archives/:folder`
- **Runner**: `POST /projects/:id/run/start`, `POST /projects/:id/run/stop`, `GET /projects/:id/run/status`, `GET /projects/:id/run/output?since=N`
- **Workflow**: `GET /projects/:id/workflow/status`, `GET /projects/:id/workflow/files`, `GET/PUT/DELETE /projects/:id/workflow/file`, `POST /projects/:id/workflow/skill/start`, `POST /projects/:id/workflow/skill/stop`, `GET /projects/:id/workflow/skill/status`, `GET /projects/:id/workflow/skill/output?since=N`, `POST /projects/:id/workflow/prd-json/validate`
- **Models**: `GET /models`, `GET /models/:provider`, `PUT/DELETE /models/:provider/token`, `PUT/DELETE /models/:provider/model`, `PUT /models/:provider/preferences`
- **Health**: `GET /health`

## Conventions

- **Backend error responses**: `{ error: string }` with appropriate HTTP status (400/404/409/500)
- **Backend success responses**: `{ success: true }` for mutations, typed payload for queries
- **Frontend query keys**: `['projects']`, `['project-status', id]`, `['models']`, `['provider', name]`, `['settings']`
- **Frontend message state**: `{ type: 'success'|'error'; text: string } | null` with auto-hide via setTimeout
- **Path validation**: Workflow editor allowlists `tasks/` directory and `scripts/ralph/prd.json`; uses `path.resolve()` to prevent traversal
- **Naming**: API routes kebab-case, DB columns snake_case, React components PascalCase, hooks `use*` camelCase
- **Styling**: Dark theme (bg-gray-900, text-gray-300), ralph purple for primary actions (`bg-ralph-600 hover:bg-ralph-700`)
