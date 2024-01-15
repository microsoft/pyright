from __future__ import annotations

from pathlib import Path
from shutil import copytree

from nodejs import npm

if not Path("node_modules").exists():
    _ = npm.run(["ci"], check=True)
_ = npm.run(["run", "build:cli:dev"], check=True)

copytree("packages/pyright/dist", "basedpyright/dist", dirs_exist_ok=True)
