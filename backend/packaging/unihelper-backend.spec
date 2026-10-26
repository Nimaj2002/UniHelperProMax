# -*- mode: python -*-
# PyInstaller spec for the desktop app's standalone backend (specs/015-desktop-app-packaging,
# research R4).
#
#   uv sync --frozen --group packaging
#   uv run pyinstaller --noconfirm packaging/unihelper-backend.spec   # → dist/unihelper-backend/
#   uv run python -m unihelper.desktop.smoke dist/unihelper-backend
#
# ONEDIR ONLY. Never switch to --onefile: a onefile build is a bootloader parent plus a Python
# child, and on Windows killing the parent (all that TerminateProcess or the app's force-kill
# does) leaves the child running with the database open.
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

ROOT = Path(SPECPATH).parent  # noqa: F821 - PyInstaller provides SPECPATH
SRC = ROOT / "src"

hiddenimports = [
    "uvicorn.lifespan.on",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.loops.auto",
    "alembic.ddl.sqlite",
    *collect_submodules("keyring.backends"),
    *collect_submodules("unihelper"),
]
if sys.platform.startswith("linux"):
    hiddenimports += collect_submodules("jeepney")  # Secret Service (keyring) over D-Bus

datas = [
    # Alembic loads revision scripts from disk at runtime: ship them as files, not just modules
    (str(SRC / "unihelper" / "db" / "migrations"), "unihelper/db/migrations"),
    *copy_metadata("unihelper"),  # importlib.metadata.version("unihelper") in /health
]

a = Analysis(  # noqa: F821
    [str(SRC / "unihelper" / "desktop" / "serve.py")],
    pathex=[str(SRC)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "mypy", "ruff"],
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # onedir: binaries go to COLLECT, not into the executable
    name="unihelper-backend",
    console=True,  # stdin/stdout pipes carry the handshake and the logs
    strip=False,
    upx=False,
)
coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="unihelper-backend",
)
