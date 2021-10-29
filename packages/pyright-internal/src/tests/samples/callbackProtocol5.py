# This sample tests the case where a callback protocol defines additional
# attributes.

from typing import Callable, Literal, Protocol, TypeVar, cast
from typing_extensions import ParamSpec


P = ParamSpec("P")
R = TypeVar("R", covariant=True)


class SomeFunc(Protocol[P, R]):
    __name__: str

    other_attribute: int

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        ...


def other_func(f: Callable[P, R]) -> SomeFunc[P, R]:
    converted = cast(SomeFunc, f)

    print(converted.__name__)

    converted.other_attribute = 1

    # This should generate an error
    converted.other_attribute = "str"

    # This should generate an error
    converted.xxx = 3

    return converted


@other_func
def some_func(x: int) -> str:
    ...


t1: Literal["SomeFunc[(x: int), str]"] = reveal_type(some_func)

some_func.other_attribute

# This should generate an error
some_func.other_attribute2

some_func(x=3)
