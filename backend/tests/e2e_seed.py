"""Configure a user's transcription provider by writing the 004 settings tables directly.

Feature 005 adds the Settings screens that write these tables; until then E2E tests and manual
checks use this helper:

    uv run python -m tests.e2e_seed set-provider --data ../data-e2e --user owner \
        --provider voice-studio --address http://localhost:8020 [--model m] [--api-key k]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select

from unihelper.config import Settings
from unihelper.db.engine import make_engine, make_sessionmaker
from unihelper.models import ProviderConfig, TranscriptionSettings, User


def set_provider(
    data: Path,
    username: str,
    provider: str,
    address: str,
    model: str | None = None,
    api_key: str | None = None,
    language: str = "auto",
) -> None:
    engine = make_engine(Settings(data_dir=data))
    with make_sessionmaker(engine)() as db:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            raise SystemExit(f"no user {username!r}")
        settings = db.get(TranscriptionSettings, user.id) or TranscriptionSettings(user_id=user.id)
        settings.active_provider_id = provider
        settings.default_language = language
        db.add(settings)
        values = {"address": address} | ({"model": model} if model else {})
        config = db.get(ProviderConfig, (user.id, provider)) or ProviderConfig(
            user_id=user.id, provider_id=provider
        )
        config.values_json = json.dumps(values)
        config.secret = api_key
        db.add(config)
        db.commit()
    engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m tests.e2e_seed")
    sub = parser.add_subparsers(dest="command", required=True)
    sp = sub.add_parser("set-provider")
    sp.add_argument("--data", type=Path, required=True)
    sp.add_argument("--user", required=True)
    sp.add_argument("--provider", required=True)
    sp.add_argument("--address", required=True)
    sp.add_argument("--model")
    sp.add_argument("--api-key")
    sp.add_argument("--language", default="auto")
    args = parser.parse_args()
    set_provider(
        args.data, args.user, args.provider, args.address, args.model, args.api_key, args.language
    )


if __name__ == "__main__":
    main()
