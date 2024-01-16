from __future__ import annotations

from json import loads
from pathlib import Path

__version__ = loads((Path(__file__).parent / "lerna.json").read_text())["version"]
