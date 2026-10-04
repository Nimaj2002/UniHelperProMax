"""Operator commands, run from a local shell only (never exposed over the API).

uv run unihelper reset-owner-password
"""

from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import select

from unihelper.api.errors import ApiError
from unihelper.config import load_settings
from unihelper.db.engine import make_engine, make_sessionmaker
from unihelper.db.migrate import upgrade_to_head
from unihelper.models import User
from unihelper.services import auth_service


def reset_owner_password(password: str | None = None) -> int:
    settings = load_settings()
    if not settings.db_path.exists():
        print(f"No database at {settings.db_path}. Set UNIHELPER_DATA_DIR.", file=sys.stderr)
        return 1
    engine = make_engine(settings)
    upgrade_to_head(engine)
    with make_sessionmaker(engine)() as db:
        owner = db.scalar(select(User).where(User.role == "owner"))
        if owner is None:
            print(
                "This installation has no owner yet; open the app to create one.", file=sys.stderr
            )
            return 1
        if password is None:
            password = getpass.getpass(f"New password for '{owner.username}': ")
            if password != getpass.getpass("Repeat it: "):
                print("Passwords don't match.", file=sys.stderr)
                return 1
        try:
            auth_service.validate_password(password, owner.username)
        except ApiError as err:
            print(err.errors[0]["message"] if err.errors else err.title, file=sys.stderr)
            return 1
        owner.password_hash = auth_service.hash_password(password)
        owner.must_change_password = True
        owner.disabled_at = None
        auth_service.revoke_sessions(db, owner.id)
        db.commit()
        print(f"Password reset for '{owner.username}'. They must change it at next sign-in.")
    engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="unihelper", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("reset-owner-password", help="Set a new password for the owner account")
    args = parser.parse_args(argv)
    if args.command == "reset-owner-password":
        return reset_owner_password()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
