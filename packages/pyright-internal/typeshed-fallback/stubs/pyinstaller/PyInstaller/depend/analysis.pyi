# https://pyinstaller.org/en/stable/hooks.html#the-pre-safe-import-module-psim-api-method

# The documentation explicitely mentions that "Normally you do not need to know about the module-graph."
# However, some PyiModuleGraph typed class attributes are still documented as existing in imphookapi.
from _typeshed import Incomplete

class PyiModuleGraph:  # incomplete
    def __init__(
        self,
        pyi_homepath: str,
        user_hook_dirs=...,
        excludes=...,
        path: Incomplete | None = ...,
        replace_paths=...,
        implies=...,
        graph: Incomplete | None = ...,
        debug: int = ...,
    ) -> None: ...
