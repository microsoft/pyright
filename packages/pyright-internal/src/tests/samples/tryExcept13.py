# This sample verifies that equivalent generic functions in try/except branches
# are not reported as redeclarations.

from collections.abc import Callable
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


try:
    from rich import print  # pyright: ignore[reportMissingImports]
except ImportError:

    def fgen(func: Callable[P, R]) -> Callable[P, R]:
        return func

else:

    def fgen(func: Callable[P, R]) -> Callable[P, R]:
        return func


try:
    from rich import print  # pyright: ignore[reportMissingImports]
except ImportError:

    def hgen(func: Callable[P, R]) -> Callable[P, R]:
        ...

else:

    def hgen(func: Callable[P, R]) -> Callable[[str], R]:
        ...
