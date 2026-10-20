"""Settings → Transcription (005 US1/US2): writes the per-user provider tables 004 reads.

Keys never leave the server: views carry only `configured` and the last 4 characters
(Constitution IV, SC-003); a connection test can use the saved key without returning it.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, validation_error
from unihelper.domain.addresses import LOCALHOST_HINT, address_problem, is_loopback
from unihelper.models import ProviderConfig, TranscriptionSettings, User
from unihelper.models.base import now_iso
from unihelper.schemas.settings import ConnectionTest, TranscriptionSettingsSave
from unihelper.secrets import store as secret_store
from unihelper.transcription.base import ProviderError, ProviderSpec
from unihelper.transcription.config import OWNER_KIND, JobConfig, saved_key
from unihelper.transcription.openai_client import test_reason
from unihelper.transcription.providers import SPECS, all_specs, build

TEST_BUDGET = 15.0
MESSAGES = {
    "invalid_address": "Enter a full web address, such as http://localhost:8000.",
    "https_required": "Use https:// for this address when an API key is set.",
}
TEST_MESSAGES = {
    "unreachable": "The server couldn't be reached.",
    "timeout": "The server didn't answer within 15 seconds.",
    "invalid_credentials": "The API key was rejected.",
    "model_not_found": "This model isn't available on the server.",
    "not_a_transcription_service": (
        "The server answered, but it isn't a compatible transcription service."
    ),
    "unknown": "The test failed for an unknown reason.",
}


def _secret_field(spec: ProviderSpec) -> str | None:
    return next((f.key for f in spec.fields if f.kind == "secret"), None)


def _values(row: ProviderConfig | None, spec: ProviderSpec) -> dict[str, str]:
    data = json.loads(row.values_json or "{}") if row else {}
    keys = {f.key for f in spec.fields if f.kind != "secret"}
    return {k: str(v) for k, v in data.items() if k in keys and v is not None}


def _complete(spec: ProviderSpec, values: dict[str, str], has_secret: bool) -> bool:
    for f in spec.fields:
        if not f.required:
            continue
        if f.kind == "secret" and not has_secret:
            return False
        if f.kind != "secret" and not values.get(f.key, "").strip():
            return False
    return True


def view(db: Session, user: User) -> dict[str, Any]:
    settings = db.get(TranscriptionSettings, user.id)
    providers = []
    for spec in all_specs():
        row = db.get(ProviderConfig, (user.id, spec.id))
        values = _values(row, spec)
        configured = bool(row and (row.secret or row.secret_id))
        secret = saved_key(db, row)
        status = row.test_status if row else "not_tested"
        if not _complete(spec, values, configured):
            status = "not_configured"
        providers.append(
            {
                "provider_id": spec.id,
                "values": values,
                "secret": {
                    "configured": configured,
                    "last4": secret[-4:] if secret and len(secret) >= 8 else None,
                    "readable": not configured or secret is not None,  # 014
                },
                "status": status,
                "last_error": row.test_error if row and status == "failed" else None,
                "tested_at": row.tested_at if row else None,
            }
        )
    return {
        "active_provider_id": settings.active_provider_id if settings else None,
        "default_language": settings.default_language if settings else "auto",
        "providers": providers,
    }


def _spec(provider_id: str, pointer: str) -> ProviderSpec:
    spec = SPECS.get(provider_id)
    if spec is None:
        raise validation_error(pointer, "unknown_provider", "Choose one of the offered providers.")
    return spec


def _clean_values(spec: ProviderSpec, raw: dict[str, str], pointer: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for f in spec.fields:
        if f.kind == "secret":
            continue
        value = str(raw.get(f.key, "")).strip()
        if len(value) > 500:
            raise validation_error(f"{pointer}/{f.key}", "too_long", "Use at most 500 characters.")
        if f.required and not value:
            raise validation_error(
                f"{pointer}/{f.key}", "field_required", f"Enter the {f.label.lower()}."
            )
        if value:
            values[f.key] = value
    return values


def _check_address(values: dict[str, str], has_key: bool, pointer: str) -> None:
    if "address" not in values:
        return
    problem = address_problem(values["address"], has_key)
    if problem:
        raise validation_error(f"{pointer}/address", problem, MESSAGES[problem])


def save(
    db: Session, user: User, body: TranscriptionSettingsSave, key_given: bool
) -> dict[str, Any]:
    _spec(body.active_provider_id, "/activeProviderId")
    spec = _spec(body.provider.provider_id, "/provider/providerId")
    values = _clean_values(spec, body.provider.values, "/provider/values")
    row = db.get(ProviderConfig, (user.id, spec.id))
    if row is None:
        row = ProviderConfig(user_id=user.id, provider_id=spec.id, values_json="{}")
        db.add(row)
    old_secret = saved_key(db, row)
    has_secret = bool(row.secret or row.secret_id)
    secret = old_secret
    if _secret_field(spec) and key_given:
        new_key = (body.provider.api_key or "").strip() or None
        if body.provider.api_key is not None and new_key is None:
            raise validation_error("/provider/apiKey", "field_required", "Enter the API key.")
        secret, has_secret = new_key, new_key is not None
    _check_address(values, has_secret, "/provider/values")
    if values != _values(row, spec) or secret != old_secret:
        row.test_status, row.test_error, row.tested_at = "not_tested", None, None
    row.values_json = json.dumps(values)
    if _secret_field(spec) and key_given:
        _store_key(db, row, secret)
    settings = db.get(TranscriptionSettings, user.id) or TranscriptionSettings(user_id=user.id)
    settings.active_provider_id = body.active_provider_id
    settings.default_language = body.default_language
    db.add(settings)
    db.flush()
    return view(db, user)


def _store_key(db: Session, row: ProviderConfig, key: str | None) -> None:
    """014: keys go into the encrypted secret store; the plaintext column stays empty."""
    store = secret_store.current()
    row.secret = None
    if key is None:
        store.remove(db, row.user_id, OWNER_KIND, row.provider_id)
        row.secret_id = None
        return
    try:
        row.secret_id = store.put(db, row.user_id, OWNER_KIND, row.provider_id, key)
    except secret_store.KeyUnreadable as exc:
        raise ApiError(
            409,
            "key_store_unreadable",
            "Saved keys can't be read on this computer.",
            "Start a new key store in Settings, then enter the key again.",
        ) from exc


async def test(
    db: Session, user: User, body: ConnectionTest, transport: httpx.AsyncBaseTransport | None
) -> dict[str, Any]:
    spec = _spec(body.provider_id, "/providerId")
    values = _clean_values(spec, body.values, "/values")
    row = db.get(ProviderConfig, (user.id, spec.id))
    key = body.api_key.strip() if body.api_key else None
    if key is None and body.use_saved_key and row is not None:
        key = saved_key(db, row)
    _check_address(values, bool(key), "/values")
    try:
        async with httpx.AsyncClient(transport=transport) as http:
            provider = build(spec.id, http)
            await asyncio.wait_for(provider.test(JobConfig(values, lambda: key)), TEST_BUDGET)
        result: dict[str, Any] = {"ok": True, "category": None, "message": None}
    except TimeoutError:
        result = {"ok": False, "category": "timeout", "message": TEST_MESSAGES["timeout"]}
    except ProviderError as err:
        reason = test_reason(err)
        result = {"ok": False, "category": reason, "message": TEST_MESSAGES[reason]}
        if reason == "unreachable" and is_loopback(values.get("address", "")):
            result["message"] += " " + LOCALHOST_HINT
    # remember the result when exactly the saved settings were tested
    if row is not None and values == _values(row, spec) and key == saved_key(db, row):
        row.test_status = "connected" if result["ok"] else "failed"
        row.test_error = result["message"]
        row.tested_at = now_iso()
        db.flush()
    return result


def mark_connected(db: Session, user_id: str, provider_id: str, values: dict[str, str]) -> None:
    """A transcription succeeded with these settings (005 edge case: "or a transcription runs")."""
    row = db.get(ProviderConfig, (user_id, provider_id))
    spec = SPECS.get(provider_id)
    if row is None or spec is None or _values(row, spec) != values:
        return
    row.test_status, row.test_error, row.tested_at = "connected", None, now_iso()
