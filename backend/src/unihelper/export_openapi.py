"""Write the live OpenAPI document to a file: python -m unihelper.export_openapi <path>."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from unihelper.config import Settings


def main() -> None:
    from unihelper.main import create_app

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    with tempfile.TemporaryDirectory() as tmp:
        app = create_app(Settings(data_dir=Path(tmp)))
        out.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
        app.state.engine.dispose()
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
