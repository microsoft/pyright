from __future__ import annotations

from json import loads
from pathlib import Path


def get_version() -> str:
    return loads((Path(__file__).parent / "lerna.json").read_text())["version"]
