"""Prompt building (context window) and syncing LLM_MODELS into the database."""

from __future__ import annotations

import json

import pytest

from apps.chat.prompting import Turn, _merge_same_roles, fit_to_window
from apps.chat.titles import clean_title, fallback_title
from apps.llm.models import LLMModel
from apps.llm.services import parse_models_config, sync_models


def test_merge_same_roles_and_start_with_user():
    turns = _merge_same_roles(
        [Turn("assistant", "orphan"), Turn("user", "a"), Turn("user", "b"), Turn("assistant", "c")]
    )
    assert [(t.role, t.text) for t in turns] == [("user", "a\n\nb"), ("assistant", "c")]


def test_fit_drops_oldest_plain_turns_first():
    turns = [
        Turn("user", "old question " * 50),
        Turn("assistant", "old answer " * 50),
        Turn("user", "doc turn", documents=[('<document name="a">', "x" * 300)], has_attachments=True),
        Turn("assistant", "ok"),
        Turn("user", "latest"),
    ]
    fitted = fit_to_window("sys", turns, budget=300)
    assert [t.text for t in fitted] == ["doc turn", "ok", "latest"]


def test_fit_trims_documents_when_needed():
    turns = [Turn("user", "q", documents=[('<document name="big">', "y" * 30_000)], has_attachments=True)]
    fitted = fit_to_window("sys", turns, budget=2000)
    text = fitted[0].documents[0][1]
    assert len(text) < 30_000
    assert "more characters not shown" in text


def test_title_helpers():
    assert clean_title('<think>hmm</think>"Trip to Lahore."') == "Trip to Lahore"
    assert clean_title("Title: Budget review") == "Budget review"
    assert fallback_title("one two three four five six seven") == "one two three four five six…"


CONFIG = [
    {
        "id": "qwen",
        "name": "Qwen",
        "provider": "sagemaker",
        "endpoint_name": "e",
        "scaling": "on_demand",
        "default": True,
        "vision": True,
    },
    {
        "id": "llama",
        "name": "Llama",
        "provider": "openai",
        "base_url": "http://ollama:11434/v1",
        "model_id": "llama3.2",
    },
]


@pytest.mark.django_db
def test_sync_models_create_update_disable():
    assert sync_models(json.dumps(CONFIG))["created"] == ["qwen", "llama"]
    qwen = LLMModel.objects.get(slug="qwen")
    assert qwen.is_default and qwen.vision and qwen.scaling == "on_demand" and qwen.managed_by_env

    hand_made = LLMModel.objects.create(slug="manual", name="Manual", provider="mock")
    result = sync_models(json.dumps(CONFIG[:1]))
    assert result["updated"] == ["qwen"]
    assert result["disabled"] == ["llama"]
    assert LLMModel.objects.get(slug="llama").enabled is False
    hand_made.refresh_from_db()
    assert hand_made.enabled  # admin-created rows are untouched


@pytest.mark.parametrize(
    "bad",
    [
        {"provider": "openai"},  # no id
        {"id": "x", "provider": "nope"},
        {"id": "x", "provider": "openai"},  # no base_url
        {"id": "x", "provider": "sagemaker"},  # no endpoint_name
        {"id": "x", "provider": "sagemaker", "endpoint_name": "e", "scaling": "sometimes"},
    ],
)
def test_parse_models_config_rejects_bad_entries(bad):
    with pytest.raises(ValueError):
        parse_models_config([bad])


@pytest.mark.django_db
def test_sync_models_from_file(tmp_path, settings):
    path = tmp_path / "models.json"
    path.write_text(json.dumps(CONFIG[1:]))
    settings.LLM_MODELS = ""
    settings.LLM_MODELS_FILE = str(path)
    assert sync_models()["created"] == ["llama"]
