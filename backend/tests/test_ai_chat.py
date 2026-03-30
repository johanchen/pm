import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import main


def _login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        data={"username": "user", "password": "password"},
        follow_redirects=False,
    )
    assert response.status_code == 303


def test_ai_chat_requires_auth(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main.init_db()

    client = TestClient(main.app)
    response = client.post("/api/ai/chat", json={"message": "Hello"})
    assert response.status_code == 401


def test_ai_chat_no_mutation(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main.init_db()

    def fake_call_openrouter_messages(messages):
        return json.dumps(
            {
                "assistant_message": "No changes needed.",
                "proposed_board": None,
            }
        )

    monkeypatch.setattr(main, "call_openrouter_messages", fake_call_openrouter_messages)

    client = TestClient(main.app)
    _login(client)
    before = client.get("/api/board").json()

    response = client.post(
        "/api/ai/chat",
        json={
            "message": "How is the board looking?",
            "conversation_history": [{"role": "user", "content": "Hi"}],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["assistant_message"] == "No changes needed."
    assert payload["board_updated"] is False
    assert payload["board"] == before


def test_ai_chat_mutation_persists(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main.init_db()

    client = TestClient(main.app)
    _login(client)
    board = client.get("/api/board").json()
    board["columns"][0]["title"] = "AI Updated Backlog"

    def fake_call_openrouter_messages(messages):
        return json.dumps(
            {
                "assistant_message": "I renamed the first column.",
                "proposed_board": board,
            }
        )

    monkeypatch.setattr(main, "call_openrouter_messages", fake_call_openrouter_messages)

    response = client.post("/api/ai/chat", json={"message": "Rename the first column."})
    assert response.status_code == 200
    payload = response.json()
    assert payload["board_updated"] is True
    assert payload["board"]["columns"][0]["title"] == "AI Updated Backlog"

    after = client.get("/api/board").json()
    assert after["columns"][0]["title"] == "AI Updated Backlog"


def test_ai_chat_malformed_output_returns_502(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main.init_db()

    def fake_call_openrouter_messages(messages):
        return "not json at all"

    monkeypatch.setattr(main, "call_openrouter_messages", fake_call_openrouter_messages)

    client = TestClient(main.app)
    _login(client)
    response = client.post("/api/ai/chat", json={"message": "Please update board."})
    assert response.status_code == 502
    assert response.json()["detail"] == "Invalid AI structured output."
