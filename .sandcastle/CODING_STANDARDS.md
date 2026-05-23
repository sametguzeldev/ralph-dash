# Coding Standards

These mirror the conventions in `CLAUDE.md`. The reviewer agent loads this file during code review so the standards are enforced without costing tokens during implementation.

## Naming

- API routes: kebab-case (`/api/projects/:id/run/start`)
- DB columns: snake_case (`model_variant`, `is_configured`)
- React components: PascalCase
- Hooks: `use*` camelCase
- Files: match the component/module name they export

## Backend (Express + TypeScript)

- Error responses: `{ error: string }` with appropriate HTTP status (400 bad input, 404 not found, 409 conflict, 500 server error)
- Success responses: `{ success: true }` for mutations; typed payload for queries
- Use the dedicated tools instead of inline calls: Express `Router` per route group, mounted at `/api/*`; services in `backend/src/services/`; providers in `backend/src/providers/`
- DB access goes through `db.prepare(...)` (better-sqlite3). Never build SQL with string interpolation; always parameterize
- Path validation for user-supplied paths: use `path.resolve()` and allowlist the destination directory to prevent traversal

## Frontend (React + Vite + TypeScript)

- All server state goes through TanStack React Query — no direct `fetch` in components
- Query keys follow the existing scheme: `['projects']`, `['project-status', id]`, `['models']`, `['provider', name]`, `['settings']`
- API calls live in `frontend/src/lib/api.ts` as typed wrappers; don't inline `fetch` in components
- Message state pattern: `{ type: 'success'|'error'; text: string } | null`, auto-hide via `setTimeout`
- Mobile responsiveness: use the `useIsMobile()` hook — sidebar hides on mobile, shows as drawer

## Styling

- Dark theme is the default: `bg-gray-900`, `text-gray-300`
- Primary actions: ralph purple — `bg-ralph-600 hover:bg-ralph-700`
- Use Tailwind utility classes — no custom CSS files unless unavoidable

## Comments and abstractions

- Default to writing no comments. Only add one when the WHY is non-obvious (hidden constraint, subtle invariant, workaround for a specific bug)
- Don't explain WHAT the code does — names should do that
- Don't reference the current task/PR/issue in comments ("added for issue #42") — that belongs in commit messages
- Don't add backwards-compatibility shims, unused-var renames, or `// removed` markers — delete the code
- No premature abstractions; three similar lines is better than a wrong abstraction
- Only validate at system boundaries (user input, external APIs). Trust internal callers

## Tests

There is no test framework configured in this repo. Don't invent one. Verify changes by running:

- `cd backend && npm run build` (tsc)
- `cd frontend && npm run build` (tsc + vite)

Both must succeed before committing.

## Security

- Never log API keys, OAuth tokens, or user credentials
- Tokens are stored in the SQLite `providers.config` JSON and injected into spawned processes via env vars only — never written to disk inside provider configs
