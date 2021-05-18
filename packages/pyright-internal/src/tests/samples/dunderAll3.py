# This sample tests dynamic __all__ assignments based on dir()

# pyright: reportMissingModuleSource=false

from typing import Any

__all__: Any

foo = 42
_bar = "asdf"

__all__ = [x for x in dir() if not x.startswith("_")]
