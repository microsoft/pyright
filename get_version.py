from __future__ import annotations

from json import loads
from pathlib import Path
from typing import TypedDict, cast


class LernaJson(TypedDict):
    version: str


def get_version() -> str:
    return cast(LernaJson, loads((Path(__file__).parent / "lerna.json").read_text()))["version"]
