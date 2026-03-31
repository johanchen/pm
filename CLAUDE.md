# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack Kanban board MVP with AI assistant integration. The frontend is a Next.js app; the backend is a FastAPI Python service that serves both the REST API and the built frontend as static files.

## Commands

### Frontend (`frontend/`)
```bash
npm install
npm run dev           # Dev server on :3000
npm run build         # Production build
npm run lint
npm run test:unit                                      # Vitest unit tests (run once)
npm run test:unit:watch                                # Vitest watch mode
npm run test:unit -- src/lib/kanban.test.ts            # Run a single test file
npm run test:unit -- --reporter=verbose                # Verbose output
npm run test:e2e                                       # Playwright E2E (requires running backend)
npm run test:e2e -- tests/kanban.spec.ts               # Single E2E spec
npm run test:all                                       # Unit + E2E
```

### Backend (`backend/`)
```bash
uv sync               # Install dependencies
pytest                # All tests
pytest tests/test_auth.py                              # Single test file
pytest tests/test_auth.py::test_login_valid            # Single test
pytest -v --tb=short
uvicorn app.main:app --reload                          # Dev server on :8000
```

### Docker
```bash
docker-compose up     # Full app on :8000 (builds frontend, serves via FastAPI)
docker-compose down
```

## Architecture

### Deployment Model
In production (Docker), FastAPI serves the built Next.js static files via `StaticFiles`. In development, Next.js runs on :3000 and the FastAPI backend runs separately on :8000.

### Authentication
Simple hardcoded credentials (user/password). `AuthRequiredMiddleware` intercepts all requests and redirects unauthenticated users to `/login`. Session stored via FastAPI `SessionMiddleware` with a cookie.

### Board State Sync
The frontend (`KanbanBoard.tsx`) holds board state in React. Every mutation schedules a debounced `PUT /api/board` (250ms). On mount it fetches `GET /api/board`. The backend validates the full `BoardPayload` on every save — including that card keys match IDs, all `cardIds` reference existing cards, and no card appears in multiple columns.

### AI Chat
User messages plus `conversation_history` are sent to `POST /api/ai/chat`. The backend injects the current board state into the system prompt and calls OpenRouter (model configured in `backend/app/main.py`). The AI returns structured JSON `{ assistant_message, proposed_board }`. If `proposed_board` is non-null, the backend saves it and the frontend replaces its state.

### Data Layer
- SQLite at `backend/data/app.db`
- Two tables: `users` (id, username) and `boards` (user_id PK, board_json TEXT)
- Board is stored as a single JSON blob per user

### Drag-and-Drop
Uses `@dnd-kit` with `closestCorners` collision detection and a 6px activation threshold. `moveCard()` in `src/lib/kanban.ts` handles both same-column reorder and cross-column moves.

## Key Files

| File | Purpose |
|------|---------|
| `backend/app/main.py` | All backend logic: DB init, auth, board API, AI integration |
| `frontend/src/components/KanbanBoard.tsx` | Root state, API sync, drag-drop orchestration, AI sidebar |
| `frontend/src/lib/kanban.ts` | Pure board logic (`moveCard`, `createId`, `initialData`) |
| `frontend/src/app/globals.css` | Design tokens (colors, fonts) |
| `docs/PLAN.md` | Parts 1–10 implementation plan and status |
| `docs/DATABASE.md` | Schema rationale |

## Environment

`.env` at repo root contains `OPENROUTER_API_KEY`. The Docker Compose mounts it into the container. For local backend dev, ensure the file exists before starting uvicorn.
