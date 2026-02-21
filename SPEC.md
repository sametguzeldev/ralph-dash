# RalphDash - Project Specification

## Project Overview

**Project Name:** RalphDash  
**Location:** `~/.PersonalProjects/ralph-dash`  
**Type:** Local web dashboard with Docker support  
**Purpose:** Monitor and control Ralph loop iterations across multiple projects

---

## Tech Stack

- **Frontend:** React + Vite (or Next.js for simplicity)
- **Backend:** Node.js Express API
- **Database:** SQLite (local, file-based) for project/task persistence
- **Container:** Docker + Docker Compose
- **Styling:** Tailwind CSS

---

## Core Features

### 1. Settings Panel
- User configures path to Ralph installation (e.g., `~/PersonalProjects/ralph`)
- Dashboard copies/links required files:
  - `skills/ralph/` folder
  - `ralph-cc.sh` script
  - `CLAUDE.md`, `README.md`, `prd.json.example`
- Path validation on save
- Settings persisted in SQLite

### 2. Projects Screen
- List all tracked projects as cards
- "Add Project" button → modal with:
  - Project name (display)
  - Path to project root (e.g., `~/ZeptoProjects/unity-template-project`)
- Delete project option
- Click project → navigate to project dashboard

### 3. Project Dashboard
**Header:**
- Project name
- Current branch (from `.last-branch`)
- PRD description
- Quick actions: Open in Finder, Open in VS Code

**Task Board (Kanban-style columns):**
| Column | Description |
|--------|-------------|
| Pending | `passes: false`, not started |
| In Progress | Currently being worked on (derived from progress.txt timestamps) |
| Done | `passes: true` |

**Task Card shows:**
- Story ID (e.g., US-001)
- Title
- Priority badge
- Expand to show acceptance criteria

**Progress Timeline:**
- Parsed from `progress.txt`
- Shows iteration history with dates
- Expandable entries showing what was done

---

## Data Structures

### prd.json (read from `projectRoot/scripts/ralph/prd.json`)
```json
{
  "project": "string",
  "branchName": "string", 
  "description": "string",
  "userStories": [
    {
      "id": "US-001",
      "title": "string",
      "description": "string",
      "acceptanceCriteria": ["string"],
      "priority": 1,
      "passes": boolean,
      "notes": "string"
    }
  ]
}
```

### progress.txt (append-only log)
- Sections with `## [Date] - [Story ID]`
- Implementation notes, files changed, learnings
- Used to derive "In Progress" status (most recent entry without matching done)

### .last-branch
- Single line: branch name (e.g., `ralph/gzip-compression`)

---

## File Structure

```
ralph-dash/
├── docker-compose.yml
├── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── App.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── db/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get current settings |
| PUT | `/api/settings` | Update settings (ralphPath) |
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Add new project |
| DELETE | `/api/projects/:id` | Remove project |
| GET | `/api/projects/:id/tasks` | Get tasks (prd.json parsed) |
| GET | `/api/projects/:id/progress` | Get progress.txt content |
| GET | `/api/projects/:id/branch` | Get current branch |

---

## UI/UX

### Theme
- Dark mode by default (developer-focused)
- Accent color: Purple/Violet (Ralph-inspired)
- Clean, minimal, information-dense

### Layout
- Sidebar navigation (Settings, Projects)
- Main content area with responsive grid

---

## Implementation Phases

### Phase 1: Foundation
1. Set up Docker + project structure
2. Backend: SQLite setup, settings CRUD
3. Frontend: Basic routing, settings page

### Phase 2: Projects Core
1. Backend: Projects CRUD, file system path validation
2. Frontend: Projects list, add/delete project
3. Integrate Ralph file copying on settings save

### Phase 3: Task Dashboard
1. Backend: Parse prd.json, progress.txt, .last-branch
2. Frontend: Kanban board with task cards
3. Progress timeline view

### Phase 4: Polish
1. Refresh button to re-read files
2. Error handling for missing files
3. Responsive design
4. Docker optimizations

---

## Acceptance Criteria

- [ ] Docker-compose up builds and runs successfully
- [ ] Settings page saves Ralph path, copies required files
- [ ] Projects can be added with valid paths
- [ ] Project dashboard shows correct task statuses from prd.json
- [ ] Progress timeline displays content from progress.txt
- [ ] Current branch displayed from .last-branch
- [ ] UI is responsive and usable

---

## Notes for Claude Code

- Use `ralph-dash` as the project name in prompts
- Start with Phase 1 (foundation)
- Prefer simplicity over features
- Use SQLite via `better-sqlite3` or `sql.js`
- Keep frontend in same repo for now (mono-repo simplicity)
