from __future__ import annotations

import sys
from pathlib import Path

from nodejs import node


def run(script_name: str):
    node.run([Path(__file__).parent / f"{script_name}.js", *sys.argv[1:]])
