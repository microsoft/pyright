from _typeshed import Incomplete, StrPath
from collections.abc import Iterable
from typing import Any

from PyInstaller.building import _PyiBlockCipher
from PyInstaller.building.datastruct import TOC, Target

# Referenced in: https://pyinstaller.org/en/stable/hooks.html#PyInstaller.utils.hooks.get_hook_config
# Not to be imported during runtime, but is the type reference for hooks and analysis configuration
# Also referenced in https://pyinstaller.org/en/stable/spec-files.html
# Not to be imported during runtime, but is the type reference for spec files which are executed as python code
class Analysis(Target):
    # https://pyinstaller.org/en/stable/hooks-config.html#hook-configuration-options
    hooksconfig: dict[str, dict[str, object]]
    # https://pyinstaller.org/en/stable/spec-files.html#spec-file-operation
    # https://pyinstaller.org/en/stable/feature-notes.html
    pure: TOC
    zipped_data: TOC
    # https://pyinstaller.org/en/stable/spec-files.html#giving-run-time-python-options
    # https://pyinstaller.org/en/stable/spec-files.html#the-splash-target
    scripts: TOC
    # https://pyinstaller.org/en/stable/feature-notes.html#practical-examples
    binaries: TOC
    zipfiles: TOC
    datas: TOC
    def __init__(
        self,
        scripts: Iterable[StrPath],
        pathex: Incomplete | None = None,
        binaries: Incomplete | None = None,
        datas: Incomplete | None = None,
        hiddenimports: Incomplete | None = None,
        hookspath: Incomplete | None = None,
        hooksconfig: dict[str, dict[str, Any]] | None = None,
        excludes: Incomplete | None = None,
        runtime_hooks: Incomplete | None = None,
        cipher: _PyiBlockCipher = None,
        win_no_prefer_redirects: bool = False,
        win_private_assemblies: bool = False,
        noarchive: bool = False,
        module_collection_mode: Incomplete | None = None,
    ) -> None: ...
