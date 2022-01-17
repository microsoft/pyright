# This sample tests the type checker's handling of ParamSpec
# and Concatenate as described in PEP 612.

from typing import Callable, Concatenate, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


class Request:
    ...


def with_request(f: Callable[Concatenate[Request, P], R]) -> Callable[P, R]:
    def inner(*args: P.args, **kwargs: P.kwargs) -> R:
        return f(Request(), *args, **kwargs)

    return inner


@with_request
def takes_int_str(request: Request, x: int, y: str) -> int:
    # use request
    return x + 7


takes_int_str(1, "A")

# This should generate an error because the first arg
# is the incorrect type.
takes_int_str("B", "A")

# This should generate an error because there are too
# many parameters.
takes_int_str(1, "A", 2)

# This should generate an error because a ParamSpec can appear
# only within the last type arg for Concatenate
def decorator1(f: Callable[Concatenate[P, P], int]) -> Callable[P, int]:
    ...


# This should generate an error because the last type arg
# for Concatenate should be a ParamSpec.
def decorator2(f: Callable[Concatenate[int, int], int]) -> Callable[P, int]:
    ...


# This should generate an error because Concatenate is missing
# its type arguments.
def decorator3(f: Callable[Concatenate, int]) -> Callable[P, int]:
    ...


def decorator4(func: Callable[P, None]) -> Callable[Concatenate[int, P], None]:
    def wrapper(x: int, /, *args: P.args, **kwargs: P.kwargs) -> None:
        ...

    return wrapper


def func1(func: Callable[Concatenate[int, P], None]) -> Callable[P, None]:
    ...


def func2(a: int, b: str, c: str) -> None:
    ...


def func3(a: int, /, b: str, c: str) -> None:
    ...


def func4(a: int, b: str, /, c: str) -> None:
    ...


v1 = func1(func2)
reveal_type(v1, expected_text="(b: str, c: str) -> None")

v2 = func1(func3)
reveal_type(v2, expected_text="(b: str, c: str) -> None")

v3 = func1(func4)
reveal_type(v3, expected_text="(b: str, /, c: str) -> None")


def func5(__fn: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
    ...


def func6(name: str, *args: str):
    ...


v5 = func5(func6, "a", "b", "c")

# This should generate an error because 1 isn't assignable to str.
v6 = func5(func6, "a", "b", "c", 1)


def func7(name: str, **kwargs: str):
    ...


v7 = func5(func7, "a", b="b", c="c")

# This should generate an error because 1 isn't assignable to str.
v8 = func5(func7, "a", b="b", c=1)
