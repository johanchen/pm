# Project Plan (Detailed)

## Confirmed Decisions (2026-03-30)
- Implement Part 1 now and get user approval before coding later parts.
- Test stack: backend uses `pytest`; frontend uses existing `vitest` + `playwright`.
- Database persistence model: single JSON board blob per user.
- Auth model for MVP: server-side session cookie with hardcoded credentials (`user` / `password`).
- AI behavior: model may propose board mutations.
- Terminology: use `SQLite` consistently.

## Part 1: Plan And Alignment

### Checklist
- [x] Expand this plan into concrete implementation and validation steps for Parts 2-10.
- [x] Create `frontend/AGENTS.md` summarizing existing frontend architecture, scripts, and tests.
- [x] Confirm unresolved assumptions (if any) before implementation.
- [x] Get explicit user approval on this plan.

### Tests
- [x] Sanity-check plan consistency against `AGENTS.md` requirements.
- [x] Verify referenced paths exist (frontend, backend, scripts, docs).

### Success Criteria
- [x] User approves plan scope and sequencing.
- [x] Team can execute each part directly from this document without re-planning.

## Part 2: Scaffolding (Docker + FastAPI + Scripts)

### Checklist
- [x] Add backend app scaffold in `backend/` using FastAPI.
- [x] Add `uv`-based Python dependency management for backend.
- [x] Add Dockerfile to build frontend assets and run FastAPI in one container.
- [x] Add container startup wiring for static site serving at `/` and API routing under `/api`.
- [x] Add cross-platform start/stop scripts in `scripts/` (PowerShell for Windows, shell scripts for Mac/Linux).
- [x] Add a minimal health endpoint and sample API endpoint (`/api/health`, `/api/ping`).

### Tests
- [x] `docker build` succeeds.
- [x] Container starts locally using scripts.
- [x] `GET /` returns scaffolded page.
- [x] `GET /api/ping` returns JSON response.

### Success Criteria
- [x] One local container serves both static UI and API.
- [x] Team can start and stop stack from scripts without manual steps.

## Part 3: Integrate Existing Frontend Into Backend Serving

### Checklist
- [x] Build frontend in Docker image.
- [x] Configure backend to serve built frontend at `/`.
- [x] Keep API routes isolated under `/api`.
- [x] Preserve existing Kanban UX behavior from frontend demo.

### Tests
- [x] Frontend unit tests pass (`vitest`).
- [x] Frontend E2E tests pass (`playwright`) against containerized app.
- [x] Verify browser navigation and static assets load through FastAPI host.

### Success Criteria
- [x] Kanban demo is visible at `/` from backend container.
- [x] No regression in current drag/add/delete/rename behavior.

## Part 4: Fake Sign-In Experience

### Checklist
- [x] Add login screen at `/` when session is unauthenticated.
- [x] Validate hardcoded credentials (`user` / `password`) server-side.
- [x] Set and clear server-side session cookie on login/logout.
- [x] Gate board access behind authenticated session.

### Tests
- [x] Backend tests for login success/failure and logout.
- [x] E2E test: unauthenticated users see login page.
- [x] E2E test: valid login shows Kanban; logout returns to login.

### Success Criteria
- [x] Kanban is inaccessible without login.
- [x] Session persists across page refresh until logout.

## Part 5: Database Modeling (SQLite JSON Per User)

### Checklist
- [x] Define SQLite schema for users and board storage.
- [x] Use one board JSON blob per user (MVP persistence model).
- [ ] Add DB initialization logic that creates file/tables if missing.
- [x] Document data model and tradeoffs in `docs/` for user sign-off.

### Proposed MVP Schema
- [x] `users` table: `id`, `username` (supports future multi-user).
- [x] `boards` table: `user_id` (unique), `board_json` (TEXT), `updated_at`.

### Tests
- [ ] DB init test creates schema on first run.
- [ ] Persistence test round-trips board JSON for a user.
- [ ] Test loading default board when no saved board exists.

### Success Criteria
- [ ] Data survives restart.
- [ ] Exactly one board record per user in MVP behavior.

## Part 6: Backend Kanban API

### Checklist
- [x] Add API endpoints to fetch and persist board data for current user.
- [x] Validate request payload shape before persistence.
- [x] Add consistent API error responses.

### API Draft
- [x] `GET /api/board` -> returns current user's board JSON.
- [x] `PUT /api/board` -> validates and saves full board JSON.

### Tests
- [x] Unit/integration tests for happy paths and validation errors.
- [x] Auth tests: endpoints require authenticated session.
- [x] Persistence tests: updates reflect on subsequent reads.

### Success Criteria
- [x] Backend is source of truth for board state.
- [x] Invalid payloads are rejected with clear errors.

## Part 7: Frontend + Backend Integration

### Checklist
- [x] Replace local-only board initialization with API fetch on load.
- [x] Save board changes through backend API.
- [x] Handle loading, save-in-flight, and error UI states minimally.
- [x] Keep interactions responsive while persisting.

### Tests
- [x] Component/integration tests for fetch + save flows.
- [x] E2E test verifies board changes persist across reload.
- [x] E2E test verifies authenticated board data isolation.

### Success Criteria
- [x] Board state is persistent and reload-safe.
- [x] Frontend no longer depends on hardcoded in-memory board after boot.

## Part 8: OpenRouter Connectivity

### Checklist
- [x] Add backend OpenRouter client using `OPENROUTER_API_KEY` from `.env`.
- [x] Configure model `nvidia/nemotron-3-nano-30b-a3b:free`.
- [x] Add simple backend connectivity endpoint for controlled verification.

### Tests
- [x] Integration test with mocked provider response.
- [x] Manual smoke test endpoint returns valid answer for prompt `2+2`.
- [x] Clear error path when API key is missing/invalid.

### Success Criteria
- [x] Backend can complete a real OpenRouter call in local container.
- [x] Connectivity failures are diagnosable from logs and API response.

## Part 9: Structured AI Response With Optional Board Mutation

### Checklist
- [x] Define strict response schema: assistant message + optional board mutation.
- [x] Send current board JSON + user message + conversation history to AI endpoint.
- [x] Validate model output against schema before applying.
- [x] Persist accepted board mutation via same board storage path.

### Response Shape (MVP)
- [x] `assistant_message: string`
- [x] `proposed_board: BoardData | null`

### Tests
- [x] Unit tests for schema validation and fallback behavior.
- [x] Integration tests for no-mutation and mutation responses.
- [x] Test malformed model output handling.

### Success Criteria
- [x] AI responses are machine-parseable and safe to process.
- [x] Optional board update path is deterministic and test-covered.

## Part 10: Sidebar AI Chat UX

### Checklist
- [x] Add sidebar chat UI to existing Kanban page.
- [x] Render conversation history and loading/error states.
- [x] Call backend AI endpoint from sidebar.
- [x] Apply returned board mutation and refresh board state automatically.

### Tests
- [x] Frontend tests for chat send/render/error flow.
- [x] E2E test: chat reply appears in sidebar.
- [x] E2E test: AI mutation updates visible board state automatically.

### Success Criteria
- [x] User can chat with AI while working on board.
- [x] Board updates from AI proposal appear without manual refresh.

## Execution Notes
- Keep implementation simple and direct; avoid speculative abstractions.
- Prioritize root-cause analysis for failures before changing code.
- Keep README and docs concise, with only operationally necessary detail.
