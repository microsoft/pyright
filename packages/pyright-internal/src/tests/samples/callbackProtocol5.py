# This sample tests the case where a callback protocol defines additional
# attributes.

from typing import Any, Callable, Protocol, TypeVar, cast
from typing_extensions import ParamSpec


P = ParamSpec("P")
R = TypeVar("R", covariant=True)


class CallbackProto1(Protocol[P, R]):
    __name__: str

    other_attribute: int

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        ...


def decorator1(f: Callable[P, R]) -> CallbackProto1[P, R]:
    converted = cast(CallbackProto1, f)

    print(converted.__name__)

    converted.other_attribute = 1

    # This should generate an error
    converted.other_attribute = "str"

    # This should generate an error
    converted.xxx = 3

    return converted


@decorator1
def func1(x: int) -> str:
    ...


reveal_type(func1, expected_text="CallbackProto1[(x: int), str]")

v1 = func1.other_attribute

# This should generate an error
v2 = func1.other_attribute2

func1(x=3)


class CallbackProto2(Protocol):
    __name__: str
    __module__: str
    __qualname__: str
    __annotations__: dict[str, Any]

    def __call__(self) -> None:
        ...


def func2() -> None:
    ...


v3: CallbackProto2 = func2
