# This sample tests the case where a Callable that includes a Concatenate
# is assigned to a ParamSpec that doesn't include a Concatenate.


from typing import Callable, TypeVar
from typing_extensions import Concatenate, ParamSpec

Pi = ParamSpec("Pi")


def is_inty(f: Callable[Pi, object]) -> Callable[Pi, int]:
    ...


Po = ParamSpec("Po")
T = TypeVar("T")


def outer(f: Callable[Concatenate[str, Po], object]):
    x = is_inty(f)
    reveal_type(x, expected_text="(str, **Po@outer) -> int")
