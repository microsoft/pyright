# Referenced in: https://pyinstaller.org/en/stable/hooks.html?highlight=get_hook_config#PyInstaller.utils.hooks.get_hook_config
# Not to be imported during runtime, but is the type reference for hooks and analysis configuration

from _typeshed import StrOrBytesPath
from collections.abc import Iterable
from typing import Any

from PyInstaller.building.datastruct import Target

class Analysis(Target):
    # https://pyinstaller.org/en/stable/hooks-config.html#hook-configuration-options
    hooksconfig: dict[str, dict[str, object]]
    def __init__(
        self,
        scripts: Iterable[StrOrBytesPath],
        pathex=...,
        binaries=...,
        datas=...,
        hiddenimports=...,
        hookspath=...,
        hooksconfig: dict[str, dict[str, Any]] | None = ...,
        excludes=...,
        runtime_hooks=...,
        cipher=...,
        win_no_prefer_redirects: bool = ...,
        win_private_assemblies: bool = ...,
        noarchive: bool = ...,
        module_collection_mode=...,
    ) -> None: ...
