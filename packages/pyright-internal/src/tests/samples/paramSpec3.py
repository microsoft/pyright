# This sample tests ParamSpec (PEP 612) behavior.

from typing import (
    Awaitable,
    Callable,
    Generic,
    Iterable,
    ParamSpec,
    TypeVar,
    overload,
)

P = ParamSpec("P")
R = TypeVar("R")


def decorator1(f: Callable[P, R]) -> Callable[P, Awaitable[R]]:
    async def inner(*args: P.args, **kwargs: P.kwargs) -> R:
        return f(*args, **kwargs)

    return inner


@decorator1
def func1(x: int, y: str) -> int:
    return x + 7


async def func2():
    await func1(1, "A")

    # This should generate an error because
    # the first parameter is not an int.
    await func1("B", "2")


@overload
def func3(x: int) -> None: ...


@overload
def func3(x: str) -> str: ...


def func3(x: int | str) -> str | None:
    if isinstance(x, int):
        return None
    else:
        return x


reveal_type(
    decorator1(func3),
    expected_text="Overload[(x: int) -> Awaitable[None], (x: str) -> Awaitable[str]]",
)


class ClassA(Generic[P, R]):
    def __init__(self, func: Callable[P, R]):
        self.func = func


def func4(f: Callable[P, R]) -> ClassA[P, R]:
    return ClassA(f)


T1 = TypeVar("T1")
T2 = TypeVar("T2")


def decorator2(f: Callable[P, R]) -> Callable[P, R]:
    return f


def func5(f: Callable[[], list[T1]]) -> Callable[[list[T2]], list[T1 | T2]]:
    def inner(res: list[T2], /) -> list[T1 | T2]: ...

    return decorator2(inner)


def func6(x: Iterable[Callable[P, None]]) -> Callable[P, None]:
    def inner(*args: P.args, **kwargs: P.kwargs) -> None:
        for fn in x:
            fn(*args, **kwargs)

    return inner


class Callback1:
    def __call__(self, x: int | str, y: int = 3) -> None: ...


class Callback2:
    def __call__(self, x: int, /) -> None: ...


class Callback3:
    def __call__(self, *args, **kwargs) -> None: ...


def func7(f1: Callable[P, R], f2: Callable[P, R]) -> Callable[P, R]: ...


def func8(cb1: Callback1, cb2: Callback2, cb3: Callback3):
    v1 = func7(cb1, cb2)
    reveal_type(v1, expected_text="(x: int, /) -> None")

    v2 = func7(cb1, cb3)
    reveal_type(v2, expected_text="(x: int | str, y: int = 3) -> None")


def func9(f: Callable[P, object], *args: P.args, **kwargs: P.kwargs) -> object:
    # This should generate an error because "name" doesn't exist.
    return f(*args, **kwargs, name="")


def func10(data: int = 1) -> None:
    pass


def func11[**P](
    cls: Callable[P, None], data: str, *args: P.args, **kwargs: P.kwargs
) -> None: ...


func11(func10, "")
func11(func10, "", 0)

# This should generate an error because one of the two "data" parameters
# does not have a default value.
func11(func10)
