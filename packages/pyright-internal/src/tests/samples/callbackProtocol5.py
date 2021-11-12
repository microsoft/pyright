# This sample tests the case where a callback protocol defines additional
# attributes.

from typing import Any, Callable, Literal, Protocol, TypeVar, cast
from typing_extensions import ParamSpec


P = ParamSpec("P")
R = TypeVar("R", covariant=True)


class SomeFunc1(Protocol[P, R]):
    __name__: str

    other_attribute: int

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        ...


def other_func1(f: Callable[P, R]) -> SomeFunc1[P, R]:
    converted = cast(SomeFunc1, f)

    print(converted.__name__)

    converted.other_attribute = 1

    # This should generate an error
    converted.other_attribute = "str"

    # This should generate an error
    converted.xxx = 3

    return converted


@other_func1
def some_func1(x: int) -> str:
    ...


t1: Literal["SomeFunc1[(x: int), str]"] = reveal_type(some_func1)

some_func1.other_attribute

# This should generate an error
some_func1.other_attribute2

some_func1(x=3)


class SomeFunc2(Protocol):
    __name__: str
    __module__: str
    __qualname__: str
    __annotations__: dict[str, Any]

    def __call__(self) -> None:
        ...


def some_func2() -> None:
    ...


v: SomeFunc2 = some_func2
