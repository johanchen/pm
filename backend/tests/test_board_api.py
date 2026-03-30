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


def test_get_board_requires_auth(tmp_path, monkeypatch):
    db_path = tmp_path / "data" / "app.db"
    monkeypatch.setattr(main, "DB_PATH", db_path)
    main.init_db()

    client = TestClient(main.app)
    response = client.get("/api/board")
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_get_board_creates_db_and_returns_default_board(tmp_path, monkeypatch):
    db_path = tmp_path / "nested" / "data" / "app.db"
    monkeypatch.setattr(main, "DB_PATH", db_path)
    client = TestClient(main.app)

    assert not db_path.exists()
    _login(client)

    response = client.get("/api/board")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["columns"]) == 5
    assert "card-1" in payload["cards"]
    assert db_path.exists()


def test_put_board_persists_board_state(tmp_path, monkeypatch):
    db_path = tmp_path / "data" / "app.db"
    monkeypatch.setattr(main, "DB_PATH", db_path)
    main.init_db()

    client = TestClient(main.app)
    _login(client)

    response = client.get("/api/board")
    board = response.json()

    board["columns"][0]["title"] = "Renamed Backlog"
    board["cards"]["card-1"]["title"] = "Updated title"
    put_response = client.put("/api/board", json=board)
    assert put_response.status_code == 200
    assert put_response.json() == {"ok": True}

    updated = client.get("/api/board")
    assert updated.status_code == 200
    data = updated.json()
    assert data["columns"][0]["title"] == "Renamed Backlog"
    assert data["cards"]["card-1"]["title"] == "Updated title"


def test_put_board_rejects_invalid_card_reference(tmp_path, monkeypatch):
    db_path = tmp_path / "data" / "app.db"
    monkeypatch.setattr(main, "DB_PATH", db_path)
    main.init_db()

    client = TestClient(main.app)
    _login(client)

    response = client.get("/api/board")
    board = response.json()
    board["columns"][0]["cardIds"].append("does-not-exist")

    put_response = client.put("/api/board", json=board)
    assert put_response.status_code == 422
