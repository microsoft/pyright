# This sample tests the case where `Callable()` is used as a class pattern.

from collections.abc import Callable
from typing import Any, Protocol, TypeVar

T = TypeVar("T")


def func1(obj: T | Callable[..., T]) -> T | None:
    match obj:
        case Callable():
            reveal_type(obj, expected_text="((...) -> Unknown) | ((...) -> T@func1)")
            return obj()


def func2(obj: T | Callable[..., T]) -> T | None:
    if isinstance(obj, Callable):
        reveal_type(obj, expected_text="((...) -> Unknown) | ((...) -> T@func2)")
        return obj()


def func3(obj: type[int] | Callable[..., str]) -> int | str | None:
    match obj:
        case Callable():
            reveal_type(obj, expected_text="type[int] | ((...) -> str)")
            return obj()


def func4(obj):
    match obj:
        case Callable():
            reveal_type(obj, expected_text="(...) -> Unknown")
            return obj()


def func5(obj: Any):
    match obj:
        case Callable():
            reveal_type(obj, expected_text="(...) -> Any")
            return obj()


def func6(obj: Callable[[], None]):
    match obj:
        case Callable():
            reveal_type(obj, expected_text="() -> None")
            return obj()

        case x:
            reveal_type(obj, expected_text="Never")


class CallableProto(Protocol):
    def __call__(self) -> None:
        pass


def func7(obj: CallableProto):
    match obj:
        case Callable():
            reveal_type(obj, expected_text="CallableProto")
            return obj()

        case x:
            reveal_type(obj, expected_text="Never")
