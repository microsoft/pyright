from __future__ import annotations

from pathlib import Path
from shutil import copytree

from nodejs import npm

if not Path("node_modules").exists():
    npm.run(["ci"], check=True)
npm.run(["run", "build:cli:dev"], check=True)

pyright_npm_package_dir = Path("packages/pyright")
pyright_pypi_package_dir = Path("basedpyright")
copytree("packages/pyright/dist", "basedpyright/dist", dirs_exist_ok=True)
