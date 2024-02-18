from __future__ import annotations

from json import loads
from pathlib import Path
from shutil import copyfile, copytree
from typing import TYPE_CHECKING, TypedDict, cast

# https://github.com/samwillis/nodejs-pypi/pull/23
if TYPE_CHECKING:
    # https://github.com/astral-sh/ruff/issues/9528
    from subprocess import run  # noqa: S404
else:
    from nodejs.npm import run


class PackageJson(TypedDict):
    bin: dict[str, str]


if not Path("node_modules").exists():
    _ = run(["ci"], check=True)
_ = run(["run", "build:cli:dev"], check=True)

npm_package_dir = Path("packages/pyright")
pypi_package_dir = Path("basedpyright")

copytree(npm_package_dir / "dist", pypi_package_dir / "dist", dirs_exist_ok=True)
for script_path in cast(PackageJson, loads((npm_package_dir / "package.json").read_text()))[
    "bin"
].values():
    _ = copyfile(npm_package_dir / script_path, pypi_package_dir / script_path)
