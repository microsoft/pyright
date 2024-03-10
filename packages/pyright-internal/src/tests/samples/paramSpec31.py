# This sample tests that an Any expression fills in a default signature
# when it binds to a ParamSpec.

from typing import Any, Callable, TypeVar
from typing_extensions import ParamSpec  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T")
P = ParamSpec("P")


def func1(f: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T: ...


def func2(a: Any) -> None:
    reveal_type(func1(a, 1), expected_text="Any")
