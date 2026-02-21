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
- **Routes**: `backend/src/routes/` — settings, projects, runner (each an Express Router)
- **Services**: `backend/src/services/` — fileParser (prd.json/progress.txt parsing), fileCopier (copies Ralph skills to projects), processManager (spawns ralph-cc.sh as detached child process)
- **Database**: SQLite via better-sqlite3 in WAL mode. Schema auto-created on startup. Two tables: `settings` (key-value) and `projects` (id, name, path, created_at)
- **DB files**: `data/ralph-dash.db` (gitignored)

### Frontend (React + Vite + TypeScript)
- **State**: TanStack React Query for all server state; auto-refetches every 3-5s on the dashboard
- **API layer**: `frontend/src/lib/api.ts` — typed fetch wrapper for all endpoints
- **Routing**: React Router v6 — `/settings`, `/projects`, `/projects/:id`
- **Styling**: Tailwind CSS with custom `ralph` purple color palette in `tailwind.config.js`

### Data Flow
- Projects live on the host filesystem. The backend reads `scripts/ralph/prd.json`, `scripts/ralph/progress.txt`, and `.last-branch` from each project's directory.
- Task status is derived: `passes: true` → done, `inProgress: true` (and not passes) → in_progress, else → pending.
- The runner spawns `ralph-cc.sh` as a detached bash process, buffers output (max 500 lines), and serves it via polling.

### Docker Volumes
- `RALPH_PATH` — set in `.env`, Ralph source installation, mounted **read-only**
- **Workspace mounts** — configured in `docker-compose.override.yml` (gitignored). Copy `docker-compose.override.example.yml` to get started. Each workspace directory is mounted read-write at the same path. Projects added to the dashboard must be under one of these mounted paths.

### File Sync
When adding a project or triggering sync, the backend copies from the Ralph installation into the project: `.claude/skills/` skill files, `scripts/ralph/ralph-cc.sh` (made executable), and `scripts/ralph/CLAUDE.md`.
