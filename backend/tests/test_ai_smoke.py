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


def test_ai_smoke_requires_auth(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    main.init_db()

    client = TestClient(main.app)
    response = client.post("/api/ai/smoke", json={"prompt": "2+2"})
    assert response.status_code == 401


def test_ai_smoke_missing_key_returns_500(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    main.init_db()

    client = TestClient(main.app)
    _login(client)
    response = client.post("/api/ai/smoke", json={"prompt": "2+2"})
    assert response.status_code == 500
    assert response.json()["detail"] == "OPENROUTER_API_KEY is not set."


def test_ai_smoke_success_with_mocked_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    main.init_db()

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": "4"}}]}

    def fake_post(url, headers, json, timeout):
        assert url == main.OPENROUTER_URL
        assert headers["Authorization"] == "Bearer test-key"
        assert json["model"] == main.OPENROUTER_MODEL
        return FakeResponse()

    monkeypatch.setattr(main.httpx, "post", fake_post)

    client = TestClient(main.app)
    _login(client)
    response = client.post("/api/ai/smoke", json={"prompt": "2+2"})
    assert response.status_code == 200
    assert response.json() == {"answer": "4", "model": main.OPENROUTER_MODEL}


def test_ai_smoke_provider_error_returns_502(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "app.db")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    main.init_db()

    class FakeResponse:
        status_code = 429

        @staticmethod
        def json():
            return {"error": {"message": "rate limited"}}

    def fake_post(url, headers, json, timeout):
        return FakeResponse()

    monkeypatch.setattr(main.httpx, "post", fake_post)

    client = TestClient(main.app)
    _login(client)
    response = client.post("/api/ai/smoke", json={"prompt": "2+2"})
    assert response.status_code == 502
    assert response.json()["detail"] == "OpenRouter returned status 429."
