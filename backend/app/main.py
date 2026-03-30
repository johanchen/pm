import os
import json
import re
import sqlite3
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, model_validator
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

app = FastAPI(title="Project Management MVP API")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = Path(os.getenv("DB_PATH", BASE_DIR / "data" / "app.db"))
LOGIN_PATH = "/login"
USERNAME = "user"
PASSWORD = "password"
OPENROUTER_MODEL = "openai/gpt-oss-120b"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

DEFAULT_BOARD = {
    "columns": [
        {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
        {"id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"]},
        {"id": "col-progress", "title": "In Progress", "cardIds": ["card-4", "card-5"]},
        {"id": "col-review", "title": "Review", "cardIds": ["card-6"]},
        {"id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"]},
    ],
    "cards": {
        "card-1": {
            "id": "card-1",
            "title": "Align roadmap themes",
            "details": "Draft quarterly themes with impact statements and metrics.",
        },
        "card-2": {
            "id": "card-2",
            "title": "Gather customer signals",
            "details": "Review support tags, sales notes, and churn feedback.",
        },
        "card-3": {
            "id": "card-3",
            "title": "Prototype analytics view",
            "details": "Sketch initial dashboard layout and key drill-downs.",
        },
        "card-4": {
            "id": "card-4",
            "title": "Refine status language",
            "details": "Standardize column labels and tone across the board.",
        },
        "card-5": {
            "id": "card-5",
            "title": "Design card layout",
            "details": "Add hierarchy and spacing for scanning dense lists.",
        },
        "card-6": {
            "id": "card-6",
            "title": "QA micro-interactions",
            "details": "Verify hover, focus, and loading states.",
        },
        "card-7": {
            "id": "card-7",
            "title": "Ship marketing page",
            "details": "Final copy approved and asset pack delivered.",
        },
        "card-8": {
            "id": "card-8",
            "title": "Close onboarding sprint",
            "details": "Document release notes and share internally.",
        },
    },
}


class CardPayload(BaseModel):
    id: str
    title: str
    details: str


class ColumnPayload(BaseModel):
    id: str
    title: str
    cardIds: list[str]


class BoardPayload(BaseModel):
    columns: list[ColumnPayload]
    cards: dict[str, CardPayload]

    @model_validator(mode="after")
    def validate_references(self):
        card_keys = set(self.cards.keys())
        seen_card_ids: set[str] = set()

        for key, card in self.cards.items():
            if key != card.id:
                raise ValueError(f"Card key '{key}' must match card.id '{card.id}'.")

        for column in self.columns:
            for card_id in column.cardIds:
                if card_id not in card_keys:
                    raise ValueError(f"Column '{column.id}' references unknown card '{card_id}'.")
                if card_id in seen_card_ids:
                    raise ValueError(f"Card '{card_id}' appears in more than one column.")
                seen_card_ids.add(card_id)

        return self


class AISmokeRequest(BaseModel):
    prompt: str = "What is 2+2? Reply with only the answer."


class AIChatMessage(BaseModel):
    role: str
    content: str

    @model_validator(mode="after")
    def validate_role(self):
        if self.role not in {"user", "assistant"}:
            raise ValueError("role must be 'user' or 'assistant'.")
        return self


class AIChatRequest(BaseModel):
    message: str
    conversation_history: list[AIChatMessage] = []


class StructuredAIOutput(BaseModel):
    assistant_message: str
    proposed_board: BoardPayload | None = None


def _get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = _get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS boards (
              user_id TEXT PRIMARY KEY,
              board_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)"
        )
        conn.commit()
    finally:
        conn.close()


def ensure_user(conn: sqlite3.Connection, username: str) -> str:
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if row:
        return row["id"]

    user_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO users (id, username) VALUES (?, ?)",
        (user_id, username),
    )
    conn.commit()
    return user_id


def get_or_create_board(conn: sqlite3.Connection, user_id: str) -> dict:
    row = conn.execute(
        "SELECT board_json FROM boards WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row:
        return json.loads(row["board_json"])

    board = json.loads(json.dumps(DEFAULT_BOARD))
    conn.execute(
        "INSERT INTO boards (user_id, board_json) VALUES (?, ?)",
        (user_id, json.dumps(board)),
    )
    conn.commit()
    return board


def save_board(conn: sqlite3.Connection, user_id: str, board: dict) -> None:
    conn.execute(
        """
        INSERT INTO boards (user_id, board_json, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE
        SET board_json = excluded.board_json,
            updated_at = datetime('now')
        """,
        (user_id, json.dumps(board)),
    )
    conn.commit()


def _extract_openrouter_text(payload: dict) -> str:
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Invalid OpenRouter response format.") from exc

    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text_parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text_parts.append(str(part.get("text", "")))
        text = "".join(text_parts)
    else:
        text = str(content)

    return text.strip()


def call_openrouter_messages(messages: list[dict[str, str]]) -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not set.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
    }

    try:
        response = httpx.post(
            OPENROUTER_URL,
            headers=headers,
            json=body,
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="OpenRouter request failed.") from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter returned status {response.status_code}.",
        )

    return _extract_openrouter_text(response.json())


def call_openrouter(prompt: str) -> str:
    return call_openrouter_messages([{"role": "user", "content": prompt}])


def _extract_json_payload(raw_text: str) -> dict:
    text = raw_text.strip()
    fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL)
    if fenced_match:
        text = fenced_match.group(1).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        first = text.find("{")
        last = text.rfind("}")
        if first == -1 or last == -1 or last <= first:
            raise HTTPException(status_code=502, detail="Invalid AI structured output.")
        candidate = text[first : last + 1]
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Invalid AI structured output.") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Invalid AI structured output.")
    return parsed


class AuthRequiredMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        is_authenticated = bool(request.session.get("authenticated"))

        if path == LOGIN_PATH and is_authenticated:
            return RedirectResponse(url="/", status_code=303)

        public_paths = {
            LOGIN_PATH,
            "/api/health",
            "/api/ping",
            "/api/auth/login",
        }

        if path in public_paths or path.startswith("/docs") or path.startswith("/openapi"):
            return await call_next(request)

        if path.startswith("/api/") and not is_authenticated:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)

        if not is_authenticated:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
            return RedirectResponse(url=LOGIN_PATH, status_code=303)

        return await call_next(request)


app.add_middleware(AuthRequiredMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "dev-insecure-session-secret"),
    same_site="lax",
    https_only=False,
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/ping")
def ping() -> dict[str, str]:
    return {"message": "pong"}


@app.get(LOGIN_PATH, response_class=HTMLResponse)
def login_page() -> str:
    return """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Login</title>
    <style>
      :root {
        --accent-yellow: #ecad0a;
        --primary-blue: #209dd7;
        --secondary-purple: #753991;
        --navy-dark: #032147;
        --gray-text: #888888;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: "Segoe UI", Arial, sans-serif;
        background: linear-gradient(140deg, #f8fbfe, #f2f6fc);
        color: var(--navy-dark);
      }
      main {
        width: min(420px, 92vw);
        background: #fff;
        border-radius: 16px;
        border: 1px solid rgba(3, 33, 71, 0.1);
        box-shadow: 0 18px 40px rgba(3, 33, 71, 0.12);
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
      }
      p {
        margin: 0 0 18px;
        color: var(--gray-text);
      }
      label {
        display: block;
        margin-bottom: 6px;
        font-size: 14px;
        font-weight: 600;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        margin-bottom: 14px;
        border: 1px solid rgba(3, 33, 71, 0.2);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 14px;
      }
      button {
        width: 100%;
        border: 0;
        border-radius: 999px;
        background: var(--secondary-purple);
        color: #fff;
        padding: 11px 16px;
        font-weight: 700;
        cursor: pointer;
      }
      .hint {
        margin-top: 12px;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Sign in</h1>
      <p>Use the MVP credentials to access your board.</p>
      <form action="/api/auth/login" method="post">
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
      <p class="hint">Credentials: user / password</p>
    </main>
  </body>
</html>
"""


@app.post("/api/auth/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    if username == USERNAME and password == PASSWORD:
        request.session["authenticated"] = True
        request.session["username"] = username
        return RedirectResponse(url="/", status_code=303)
    return RedirectResponse(url=f"{LOGIN_PATH}?error=1", status_code=303)


@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/board")
def get_board(request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Unauthorized")

    init_db()
    conn = _get_connection()
    try:
        user_id = ensure_user(conn, username)
        return get_or_create_board(conn, user_id)
    finally:
        conn.close()


@app.put("/api/board")
def put_board(request: Request, payload: BoardPayload):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Unauthorized")

    init_db()
    conn = _get_connection()
    try:
        user_id = ensure_user(conn, username)
        save_board(conn, user_id, payload.model_dump())
        return {"ok": True}
    finally:
        conn.close()


@app.post("/api/ai/smoke")
def ai_smoke(request: Request, payload: AISmokeRequest):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Unauthorized")

    answer = call_openrouter(payload.prompt)
    return {"answer": answer, "model": OPENROUTER_MODEL}


@app.post("/api/ai/chat")
def ai_chat(request: Request, payload: AIChatRequest):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Unauthorized")

    init_db()
    conn = _get_connection()
    try:
        user_id = ensure_user(conn, username)
        current_board = get_or_create_board(conn, user_id)

        system_prompt = (
            "You are a Kanban assistant. "
            "Return ONLY valid JSON with this exact shape: "
            '{"assistant_message":"string","proposed_board":null|{"columns":[{"id":"string","title":"string","cardIds":["string"]}],"cards":{"card-id":{"id":"string","title":"string","details":"string"}}}}. '
            "If no board change is needed, set proposed_board to null."
        )

        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        messages.append(
            {
                "role": "system",
                "content": f"Current board JSON:\n{json.dumps(current_board)}",
            }
        )

        for msg in payload.conversation_history:
            messages.append({"role": msg.role, "content": msg.content})

        messages.append({"role": "user", "content": payload.message})
        raw_response = call_openrouter_messages(messages)
        parsed = _extract_json_payload(raw_response)

        try:
            structured = StructuredAIOutput.model_validate(parsed)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid AI structured output.") from exc

        board_updated = False
        resulting_board = current_board

        if structured.proposed_board is not None:
            resulting_board = structured.proposed_board.model_dump()
            save_board(conn, user_id, resulting_board)
            board_updated = True

        return {
            "assistant_message": structured.assistant_message,
            "board_updated": board_updated,
            "board": resulting_board,
        }
    finally:
        conn.close()


# Mount app static build at root for authenticated users.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
