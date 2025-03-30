# This sample tests the handling of overloads with a ParamSpec.

from typing import Callable, Concatenate, overload, TypeVar, ParamSpec

P = ParamSpec("P")
R = TypeVar("R")


def callable1(
    func: Callable[P, R], *args: P.args, **kwargs: P.kwargs
) -> Callable[[], R]: ...


@overload
def func1() -> None: ...


@overload
def func1(a: int) -> None: ...


def func1(a: int = 1) -> None: ...


callable1(func1)
callable1(func1, 1)
callable1(func1, a=1)

# This should generate an error because none of the overloads
# captured by the ParamSpec match those arguments.
callable1(func1, 1, 2)

# This should generate an error because none of the overloads
# captured by the ParamSpec match those arguments.
callable1(func1, b=2)


def callable2(
    func: Callable[Concatenate[int, P], R], *args: P.args, **kwargs: P.kwargs
) -> Callable[[], R]: ...


@overload
def func2() -> None: ...


@overload
def func2(a: int) -> int: ...


@overload
def func2(a: int, b: str) -> str: ...


def func2(a: int = 1, b: str = "") -> None | int | str: ...


callable2(func2)
callable2(func2, "")
callable2(func2, b="")

# This should generate an error because none of the overloads
# captured by the ParamSpec match those arguments.
callable2(func2, 1, "")


def callable3(func: Callable[P, R]) -> Callable[Concatenate[int, P], R]: ...


c3_2 = callable3(func2)
c3_2(1)
c3_2(1, a=1)
c3_2(1, 1, b="")

# This should generate an error because none of the overloads
# match these arguments.
c3_2(1, "")

# This should generate an error because none of the overloads
# match these arguments.
c3_2(1, 1, c="")


@overload
def func3(x: int) -> None: ...


@overload
def func3(x: str) -> None: ...


def func3(x) -> None:
    pass


def callable4(func: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R: ...


callable4(func3, 1)
callable4(func3, x=1)
callable4(func3, "")
callable4(func3, x="")

# This should generate an error.
callable4(func3, 1.0)

# This should generate two errors because x is missing and y is unknown.
callable4(func3, y=1)


@overload
def func4(x: str) -> str: ...


@overload
def func4(x: int) -> int: ...


def func4(x: str | int):
    return x


def callable5(f: Callable[P, R]):
    def inner(*args: P.args, **kwargs: P.kwargs) -> list[R]:
        return [f(*args, **kwargs)]

    return inner


callable5(func4)(0)
callable5(func4)("")
