"""Environment parsing in config/settings/base.py."""

from __future__ import annotations

from config.settings.base import BASE_DIR, database_from_env


def test_database_url_postgres(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://u%40x:p%2Fw@db.example.com:6543/chat")
    db = database_from_env()
    assert (db["USER"], db["PASSWORD"], db["HOST"], db["PORT"], db["NAME"]) == (
        "u@x",
        "p/w",
        "db.example.com",
        "6543",
        "chat",
    )


def test_database_url_sqlite_relative_and_absolute(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///db.sqlite3")
    assert database_from_env()["NAME"] == BASE_DIR / "db.sqlite3"
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/chat.sqlite3")
    assert database_from_env()["NAME"] == "/tmp/chat.sqlite3"


def test_database_from_pieces(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_HOST", "rds.local")
    monkeypatch.setenv("DB_PASSWORD", "secret")
    db = database_from_env()
    assert db["HOST"] == "rds.local" and db["PASSWORD"] == "secret" and db["NAME"] == "llmchat"
