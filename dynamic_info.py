from __future__ import annotations

from json import loads
from pathlib import Path

root_dir = Path(__file__).parent


def get_version() -> str:
    return loads((root_dir / "lerna.json").read_text())["version"]


def get_description() -> str:
    return loads((root_dir / "package.json").read_text())["description"]
