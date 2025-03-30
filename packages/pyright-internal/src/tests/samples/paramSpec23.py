# This sample tests the case where a Callable that includes a Concatenate
# is assigned to a ParamSpec that doesn't include a Concatenate.


from typing import Callable, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Concatenate,
    ParamSpec,
)

P = ParamSpec("P")


def is_inty(f: Callable[P, object]) -> Callable[P, int]: ...


T = TypeVar("T")


def outer(f: Callable[Concatenate[str, P], object]):
    x = is_inty(f)
    reveal_type(x, expected_text="(str, **P@outer) -> int")
