import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.main import app


def test_root_redirects_to_login_when_unauthenticated():
    client = TestClient(app)
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/login"


def test_login_with_invalid_credentials_stays_unauthenticated():
    client = TestClient(app)
    response = client.post(
        "/api/auth/login",
        data={"username": "wrong", "password": "wrong"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/login?error=1"

    root_response = client.get("/", follow_redirects=False)
    assert root_response.status_code == 303
    assert root_response.headers["location"] == "/login"


def test_login_with_valid_credentials_allows_root():
    client = TestClient(app)
    login_response = client.post(
        "/api/auth/login",
        data={"username": "user", "password": "password"},
        follow_redirects=False,
    )
    assert login_response.status_code == 303
    assert login_response.headers["location"] == "/"

    root_response = client.get("/")
    assert root_response.status_code == 200
    assert "Sign in" not in root_response.text


def test_logout_clears_session():
    client = TestClient(app)
    client.post(
        "/api/auth/login",
        data={"username": "user", "password": "password"},
        follow_redirects=False,
    )

    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 200
    assert logout_response.json() == {"ok": True}

    root_response = client.get("/", follow_redirects=False)
    assert root_response.status_code == 303
    assert root_response.headers["location"] == "/login"
