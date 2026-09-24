"""The GPU controller: the decision table, and one tick against a fake AWS."""

from __future__ import annotations

from datetime import timedelta

import pytest
from botocore.exceptions import ClientError
from django.utils import timezone

from apps.llm.controller import FAILURE_BACKOFF, NOT_FOUND, GpuController, decide, wants_running
from apps.llm.models import LLMModel

NOW = timezone.now()


def d(**kw):
    base = {
        "scaling": "on_demand",
        "want": True,
        "status": NOT_FOUND,
        "running_config": "",
        "target_config": "cfg-2",
        "last_used_at": None,
        "last_error_at": None,
        "now": NOW,
    }
    return decide(**{**base, **kw}).action


@pytest.mark.parametrize(
    ("kw", "action"),
    [
        ({}, "create"),
        ({"want": False}, None),
        ({"want": False, "status": "InService"}, "delete"),
        ({"status": "Creating"}, None),
        ({"want": False, "status": "Creating"}, None),  # never interrupt a start
        ({"status": "Failed"}, "clear_failed"),
        ({"last_error_at": NOW - timedelta(minutes=1)}, None),  # back off after a failure
        ({"last_error_at": NOW - FAILURE_BACKOFF - timedelta(seconds=1)}, "create"),
        ({"target_config": ""}, None),
        ({"scaling": "manual", "status": "InService", "want": False}, None),
        ({"status": "Unknown"}, None),
        ({"status": "InService", "running_config": "cfg-1"}, "recreate"),
        ({"status": "InService", "running_config": "cfg-1", "last_used_at": NOW - timedelta(minutes=1)}, None),
    ],
)
def test_decide(kw, action):
    assert d(**kw) == action


def model(**kw) -> LLMModel:
    base = {
        "slug": "m",
        "name": "M",
        "provider": "sagemaker",
        "endpoint_name": "e",
        "endpoint_config_name": "cfg",
        "scaling": "on_demand",
        "idle_minutes": 30,
    }
    return LLMModel(**{**base, **kw})


def test_wants_running():
    assert wants_running(model(scaling="always_on"), NOW)
    assert not wants_running(model(scaling="off", last_used_at=NOW), NOW)
    assert wants_running(model(last_used_at=NOW - timedelta(minutes=29)), NOW)
    assert not wants_running(model(last_used_at=NOW - timedelta(minutes=31)), NOW)
    assert wants_running(model(wake_requested_at=NOW), NOW)


class FakeSageMaker:
    def __init__(self, status: str | None):
        self.status = status
        self.created = []
        self.deleted = []

    def describe_endpoint(self, EndpointName):
        if self.status is None:
            raise ClientError(
                {"Error": {"Code": "ValidationException", "Message": f"Could not find endpoint {EndpointName}."}},
                "DescribeEndpoint",
            )
        return {"EndpointStatus": self.status, "EndpointConfigName": "cfg"}

    def create_endpoint(self, EndpointName, EndpointConfigName):
        self.created.append((EndpointName, EndpointConfigName))

    def delete_endpoint(self, EndpointName):
        self.deleted.append(EndpointName)


@pytest.mark.django_db
def test_tick_starts_a_wanted_endpoint_and_stops_an_idle_one():
    wanted = model(slug="wanted", endpoint_name="e-wanted", wake_requested_at=timezone.now())
    idle = model(slug="idle", endpoint_name="e-idle", last_used_at=timezone.now() - timedelta(hours=2))
    wanted.save()
    idle.save()
    fakes = {"stopped": FakeSageMaker(None), "running": FakeSageMaker("InService")}

    def factory(region):
        return Router(fakes)

    class Router:
        def __init__(self, f):
            self.f = f

        def _pick(self, name):
            return self.f["stopped"] if name == "e-wanted" else self.f["running"]

        def describe_endpoint(self, EndpointName):
            return self._pick(EndpointName).describe_endpoint(EndpointName)

        def create_endpoint(self, EndpointName, EndpointConfigName):
            return self._pick(EndpointName).create_endpoint(EndpointName, EndpointConfigName)

        def delete_endpoint(self, EndpointName):
            return self._pick(EndpointName).delete_endpoint(EndpointName)

    decisions = GpuController(sagemaker_client_factory=factory).tick()
    assert decisions["wanted"].action == "create"
    assert decisions["idle"].action == "delete"
    assert fakes["stopped"].created == [("e-wanted", "cfg")]
    assert fakes["running"].deleted == ["e-idle"]
    wanted.refresh_from_db()
    assert wanted.endpoint_status == "Creating"


@pytest.mark.django_db
def test_quota_error_is_recorded():
    m = model(scaling="always_on")
    m.save()

    class NoQuota(FakeSageMaker):
        def create_endpoint(self, EndpointName, EndpointConfigName):
            raise ClientError(
                {"Error": {"Code": "ResourceLimitExceeded", "Message": "account-level service limit"}}, "CreateEndpoint"
            )

    GpuController(sagemaker_client_factory=lambda region: NoQuota(None)).tick()
    m.refresh_from_db()
    assert "ResourceLimitExceeded" in m.endpoint_error
    assert m.last_error_at is not None


@pytest.mark.django_db
def test_models_sharing_an_endpoint_are_one_group(settings):
    """vLLM router: the owner (on_demand) starts the endpoint when ANY sibling is used."""
    owner = model(slug="vision", name="Vision", endpoint_name="shared", sort=10, last_used_at=None)
    sibling = model(
        slug="text", name="Text", endpoint_name="shared", scaling="manual", sort=20, endpoint_config_name=""
    )
    owner.save()
    sibling.save()
    sibling.touch()  # someone chats with the manual sibling only
    fake = FakeSageMaker(None)
    decisions = GpuController(sagemaker_client_factory=lambda region: fake).tick()
    assert decisions["vision"].action == decisions["text"].action == "create"
    assert fake.created == [("shared", "cfg")]
    sibling.refresh_from_db()
    assert sibling.endpoint_status == "Creating"  # status is shared too
    assert sibling.endpoint_owner().pk == owner.pk


@pytest.mark.django_db
def test_manual_sibling_follows_the_owner_scaling(auth_client):
    owner = model(
        slug="vision",
        name="Vision",
        endpoint_name="shared",
        endpoint_status="NotFound",
        status_checked_at=timezone.now(),
    )
    sibling = model(
        slug="text",
        name="Text",
        endpoint_name="shared",
        scaling="manual",
        endpoint_status="NotFound",
        status_checked_at=timezone.now(),
        is_default=True,
    )
    owner.save()
    sibling.save()
    cid = auth_client.post_json("/api/conversations/", {"model": "text"}).json()["id"]
    res = auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "hi"})
    assert res.json()["code"] == "model_starting"  # not "model_unavailable"
    sibling.refresh_from_db()
    assert sibling.wake_requested_at is not None
