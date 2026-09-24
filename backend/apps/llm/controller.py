"""The GPU controller: keeps each SageMaker endpoint in the state its model wants.

A GPU endpoint costs money for every hour it EXISTS, busy or not
(ml.g6e.xlarge is about $2.61/hour in us-east-1, i.e. ~$1,900/month). Most private
deployments are idle most of the day. So Terraform creates the model and the
endpoint *configuration* (cheap, free when idle), and this controller creates
and deletes the *endpoint* itself:

    scaling = on_demand   exists while people use the model; deleted after
                          `idle_minutes` of no use. First message after a
                          quiet period waits for a cold start (5-15 min).
    scaling = always_on   kept running.
    scaling = off         kept deleted.
    scaling = manual      never touched (you manage it yourself).

It runs as its own small process: `python manage.py gpu_controller` (an ECS
service on AWS). Every tick it describes each endpoint, decides, and acts.
`decide()` is a pure function, so the policy is easy to read and test.

Lessons carried over from running this in production:

* Changing an endpoint in place (UpdateEndpoint) is a blue/green swap that
  needs capacity for TWO instances. With a quota of one GPU it always fails,
  so a config change is applied as delete -> wait until gone -> create.
* SageMaker rejects DeleteEndpoint while an endpoint is Creating/Updating;
  those states are waited out, never interrupted.
* A failed start holds the GPU for the whole startup timeout, so after a
  failure we wait FAILURE_BACKOFF before trying again instead of looping.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from .models import LLMModel

log = logging.getLogger(__name__)

FAILURE_BACKOFF = timedelta(minutes=10)
# A running endpoint whose configuration changed (new model version) is
# recreated only after it has been unused this long, so nobody is cut off
# mid-answer.
RECREATE_WHEN_IDLE_FOR = timedelta(minutes=5)
_LOCK_KEY = 8_301_442_107  # arbitrary, stable: identifies this controller's lock

NOT_FOUND = "NotFound"
UNKNOWN = "Unknown"


@dataclass(frozen=True)
class Decision:
    action: str | None  # "create" | "delete" | "recreate" | "clear_failed" | None
    reason: str


def wants_running(model: LLMModel, now: datetime) -> bool:
    if model.scaling == LLMModel.Scaling.ALWAYS_ON:
        return True
    if model.scaling in (LLMModel.Scaling.OFF, LLMModel.Scaling.MANUAL):
        return False
    window = timedelta(minutes=model.idle_minutes)
    recent = [t for t in (model.last_used_at, model.wake_requested_at) if t]
    return any(now - t < window for t in recent)


def group_wants_running(owner: LLMModel, group: list[LLMModel], now: datetime) -> bool:
    """For models sharing one endpoint: using ANY of them keeps it running."""
    if owner.scaling != LLMModel.Scaling.ON_DEMAND:
        return wants_running(owner, now)
    window = timedelta(minutes=owner.idle_minutes)
    return any(now - t < window for m in group for t in (m.last_used_at, m.wake_requested_at) if t)


def owner_of(group: list[LLMModel]) -> LLMModel:
    """The first model (by sort order) whose scaling is not manual."""
    ordered = sorted(group, key=lambda m: (m.sort, m.name))
    return next((m for m in ordered if m.scaling != LLMModel.Scaling.MANUAL), ordered[0])


def decide(
    *,
    scaling: str,
    want: bool,
    status: str,
    running_config: str,
    target_config: str,
    last_used_at: datetime | None,
    last_error_at: datetime | None,
    now: datetime,
) -> Decision:
    """Pick at most one action for one model. Pure: no AWS, no database."""
    if scaling == LLMModel.Scaling.MANUAL:
        return Decision(None, "manual scaling: observe only")
    if status == UNKNOWN:
        return Decision(None, "endpoint status unknown")
    if status == "Failed":
        # Deleting frees the instance quota so a later tick can retry.
        return Decision("clear_failed", "the endpoint failed to start")

    if want:
        if status == NOT_FOUND:
            if last_error_at and now - last_error_at < FAILURE_BACKOFF:
                return Decision(None, "waiting after a failed start")
            if not target_config:
                return Decision(None, "no endpoint configuration to start from")
            return Decision("create", "wanted and not running")
        if (
            status == "InService"
            and target_config
            and running_config
            and running_config != target_config
            and (last_used_at is None or now - last_used_at > RECREATE_WHEN_IDLE_FOR)
        ):
            return Decision("recreate", "a newer endpoint configuration is available")
        return Decision(None, "running, or already changing state")

    if status in ("InService", "OutOfService"):
        return Decision("delete", "not wanted: idle or switched off")
    return Decision(None, "stopped, or already changing state")


class GpuController:
    def __init__(self, sagemaker_client_factory=None):
        self._factory = sagemaker_client_factory or (lambda region: boto3.client("sagemaker", region_name=region))
        self._clients: dict[str, object] = {}

    def client(self, region: str):
        if region not in self._clients:
            self._clients[region] = self._factory(region)
        return self._clients[region]

    # ------------------------------------------------------------- observe --

    def describe(self, model: LLMModel) -> tuple[str, str, str]:
        """(status, running endpoint config, failure reason)."""
        region = model.region or settings.AWS_REGION
        try:
            resp = self.client(region).describe_endpoint(EndpointName=model.endpoint_name)
        except ClientError as exc:
            message = exc.response.get("Error", {}).get("Message", "")
            if "Could not find endpoint" in message or "not found" in message.lower():
                return NOT_FOUND, "", ""
            log.warning("describe_endpoint failed", extra={"model": model.slug, "error": type(exc).__name__})
            return UNKNOWN, "", ""
        except BotoCoreError as exc:
            log.warning("describe_endpoint failed", extra={"model": model.slug, "error": type(exc).__name__})
            return UNKNOWN, "", ""
        return (
            resp.get("EndpointStatus", UNKNOWN),
            resp.get("EndpointConfigName", ""),
            resp.get("FailureReason", ""),
        )

    # ---------------------------------------------------------------- tick --

    def tick(self, now: datetime | None = None) -> dict[str, Decision]:
        now = now or timezone.now()
        decisions: dict[str, Decision] = {}
        with transaction.atomic():
            if not _leader_lock():
                return decisions  # another controller instance is acting this tick
            models = LLMModel.objects.filter(provider=LLMModel.Provider.SAGEMAKER, enabled=True).exclude(
                endpoint_name=""
            )
            # One decision per ENDPOINT: several models may share one (vLLM router).
            groups: dict[tuple[str, str], list[LLMModel]] = {}
            for model in models:
                groups.setdefault((model.region or settings.AWS_REGION, model.endpoint_name), []).append(model)
            for group in groups.values():
                decision = self._tick_group(owner_of(group), group, now)
                for model in group:
                    decisions[model.slug] = decision
        return decisions

    def _tick_group(self, model: LLMModel, group: list[LLMModel], now: datetime) -> Decision:
        """`model` is the group's owner: its scaling mode and configuration apply."""
        status, running_config, failure = self.describe(model)
        if status != model.endpoint_status:
            log.info(
                "endpoint status changed",
                extra={"model": model.slug, "status": status, "previous": model.endpoint_status},
            )
        decision = decide(
            scaling=model.scaling,
            want=group_wants_running(model, group, now),
            status=status,
            running_config=running_config,
            target_config=model.endpoint_config_name,
            last_used_at=max((m.last_used_at for m in group if m.last_used_at), default=None),
            last_error_at=model.last_error_at,
            now=now,
        )
        updates: dict = {"endpoint_status": status, "status_checked_at": now}
        if status == "InService":
            updates["wake_requested_at"] = None
            updates["endpoint_error"] = ""
        if decision.action:
            self._apply(model, decision, failure, updates, now)
        LLMModel.objects.filter(pk__in=[m.pk for m in group]).update(**updates)
        return decision

    def _apply(self, model: LLMModel, decision: Decision, failure: str, updates: dict, now: datetime) -> None:
        sm = self.client(model.region or settings.AWS_REGION)
        log.info(
            "gpu controller action", extra={"model": model.slug, "action": decision.action, "reason": decision.reason}
        )
        try:
            if decision.action == "create":
                sm.create_endpoint(EndpointName=model.endpoint_name, EndpointConfigName=model.endpoint_config_name)
                updates["endpoint_status"] = "Creating"
                updates["last_started_at"] = now
            elif decision.action in ("delete", "recreate"):
                sm.delete_endpoint(EndpointName=model.endpoint_name)
                updates["endpoint_status"] = "Deleting"
                updates["last_stopped_at"] = now
            elif decision.action == "clear_failed":
                updates["endpoint_error"] = (failure or "no reason given")[:2000]
                updates["last_error_at"] = now
                updates["wake_requested_at"] = None
                sm.delete_endpoint(EndpointName=model.endpoint_name)
                updates["endpoint_status"] = "Deleting"
        except (ClientError, BotoCoreError) as exc:
            code = exc.response.get("Error", {}).get("Code", "") if isinstance(exc, ClientError) else type(exc).__name__
            message = exc.response.get("Error", {}).get("Message", "") if isinstance(exc, ClientError) else str(exc)
            # The most common one on a new account: ResourceLimitExceeded, i.e.
            # no GPU quota for this instance type. Surfaced in the admin.
            updates["endpoint_error"] = f"{decision.action} failed: {code}: {message}"[:2000]
            updates["last_error_at"] = now
            log.warning("gpu controller action failed", extra={"model": model.slug, "error": code})

    def run_forever(self, interval: int) -> None:
        log.info("gpu controller started", extra={"interval": interval})
        while True:
            try:
                self.tick()
            except Exception:  # noqa: BLE001 - one bad tick must not kill the loop
                log.exception("gpu controller tick failed")
            finally:
                # Don't hold a database connection open while sleeping.
                connection.close()
            time.sleep(interval)


def _leader_lock() -> bool:
    """Only one controller acts per tick, even if two tasks are running.

    A Postgres advisory lock scoped to the transaction: released
    automatically when the tick's transaction ends.
    """
    if connection.vendor != "postgresql":
        return True
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_xact_lock(%s)", [_LOCK_KEY])
        return bool(cursor.fetchone()[0])
