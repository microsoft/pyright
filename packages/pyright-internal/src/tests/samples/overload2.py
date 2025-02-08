# This sample verifies that a lone overload is reported
# as an error.

from typing import Any, Callable, ParamSpec, Protocol, TypeVar, overload

T = TypeVar("T")
P = ParamSpec("P")


# This should generate an error because there is only one overload.
@overload
def func1() -> None: ...


def func1() -> None: ...


# This should generate an error because there is only one overload.
@overload
def func2(a: int) -> None: ...


def func2(a: int) -> None:
    pass


class ClassA:
    # This should generate an error because there is no implementation.
    @overload
    def func3(self) -> None: ...

    @overload
    def func3(self, a: int) -> None: ...


class ClassB(Protocol):
    # An implementation should not be required in a protocol class.
    @overload
    def func4(self) -> None: ...

    @overload
    def func4(self, name: str) -> str: ...


def deco1(
    _origin: Callable[P, T],
) -> Callable[[Callable[..., Any]], Callable[P, T]]: ...


@overload
def func5(v: int) -> int: ...


@overload
def func5(v: str) -> str: ...


def func5(v: int | str) -> int | str: ...


@deco1(func5)
def func6(*args: Any, **kwargs: Any) -> Any: ...


@overload
def deco2() -> Callable[[Callable[P, T]], Callable[P, T | None]]: ...


@overload
def deco2(
    x: Callable[[], T],
) -> Callable[[Callable[P, T]], Callable[P, T]]: ...


def deco2(
    x: Callable[[], T | None] = lambda: None,
) -> Callable[[Callable[P, T]], Callable[P, T | None]]: ...


@deco2(x=dict)
def func7() -> dict[str, str]:
    return {}


class ClassC[T]:
    def __init__(self, _: T): ...
    def __call__(self, a) -> T: ...


@ClassC(print)
def func8(a: int) -> None: ...
