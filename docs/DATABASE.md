# Database Model (Part 5)

## Goal
Persist one Kanban board per user in SQLite using a single JSON blob for board state.

## Why This Model
- Matches MVP requirement: one board per signed-in user.
- Keeps backend logic simple for rapid iteration.
- Supports future multi-user by storing each board against `user_id`.

## Storage Location
- SQLite file path (proposed for Part 6): `backend/data/app.db`
- If file or parent directory does not exist, create it at app startup.

## Schema (MVP)

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS boards (
  user_id TEXT PRIMARY KEY,
  board_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
```

## JSON Payload Shape
`boards.board_json` stores the complete board document:

```json
{
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "cardIds": ["card-1"] }
  ],
  "cards": {
    "card-1": { "id": "card-1", "title": "Task", "details": "Notes" }
  }
}
```

## Read/Write Rules (For Part 6)
- Read flow:
  - Resolve current user from authenticated session (`username`).
  - Ensure user row exists (insert if missing).
  - Return stored board JSON.
  - If no board row exists, return default board JSON and create row.
- Write flow:
  - Validate incoming board payload shape.
  - Upsert JSON into `boards` by `user_id`.
  - Update `updated_at` to current timestamp.

## Tradeoffs
- Pros:
  - Very small implementation surface.
  - Easy to persist/restore full board in one query.
  - Flexible schema while UI is evolving.
- Cons:
  - Limited queryability for analytics/search over cards.
  - Full-document writes on every update.
  - Conflict handling for concurrent edits is coarse-grained.

## Migration Path (Post-MVP)
- Keep `boards` as source of truth for compatibility.
- Add normalized tables (`columns`, `cards`) when query complexity requires it.
- Backfill from `board_json` to normalized tables in one migration.

## Sign-off Request
Please confirm this schema and storage approach so Part 6 can implement the DB layer exactly as documented.
