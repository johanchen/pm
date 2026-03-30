# Frontend Agent Guide

## Purpose
This folder contains the current Next.js frontend MVP for the Kanban board demo.

## Current Status
- This frontend is currently standalone and client-side.
- Board state is in-memory only (not persisted to backend/db yet).
- Includes unit tests and Playwright E2E tests.

## Stack
- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- `@dnd-kit` for drag and drop
- Vitest + Testing Library (unit/component)
- Playwright (E2E)

## Run Commands
From `frontend/`:

```bash
npm install
npm run dev
npm run build
npm run start
npm run test:unit
npm run test:e2e
npm run test:all
```

## Key Files
- `src/app/page.tsx`: renders `KanbanBoard`.
- `src/components/KanbanBoard.tsx`: top-level board state and interactions.
- `src/components/KanbanColumn.tsx`: column UI, renaming, add-card entry.
- `src/components/KanbanCard.tsx`: sortable card UI and delete action.
- `src/components/NewCardForm.tsx`: inline add-card form.
- `src/lib/kanban.ts`: board types, seed data, card move logic.

## Current Board Behavior
- Five fixed columns are seeded from `initialData`.
- Column titles can be renamed inline.
- Cards can be created and deleted.
- Cards can be moved/reordered with drag and drop.
- No authentication in frontend yet.
- No backend API integration yet.

## Styling Direction
- Color tokens are defined in `src/app/globals.css` and align with project palette.
- Font setup is in `src/app/layout.tsx` using Google fonts.

## Testing
- Unit tests:
  - `src/lib/kanban.test.ts` covers move logic.
  - `src/components/KanbanBoard.test.tsx` covers render/rename/add/remove flows.
- E2E tests:
  - `tests/kanban.spec.ts` covers page load, add card, and drag between columns.

## Notes For Future Integration
- Replace in-memory initialization with backend fetch.
- Persist board updates to backend API.
- Add login gate and AI sidebar in later project phases.
