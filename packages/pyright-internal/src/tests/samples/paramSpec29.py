# This sample tests the case where an inner function uses concatenation
# and the return type of the outer function doesn't.

from typing import Callable, Concatenate, ParamSpec

P = ParamSpec("P")


def decorator1(f: Callable[P, None]) -> Callable[P, None]:
    def inner(var: int, *args: P.args, **kwargs: P.kwargs) -> None:
        f(*args, **kwargs)

    # This should generate an error because the concatenated parameters don't match.
    return inner


def decorator2(f: Callable[P, None]) -> Callable[Concatenate[int, P], None]:
    def inner(*args: P.args, **kwargs: P.kwargs) -> None:
        f(*args, **kwargs)

    # This should generate an error because the concatenated parameters don't match.
    return inner


def decorator3(f: Callable[P, None]) -> Callable[Concatenate[int, P], None]:
    def inner(var: str, *args: P.args, **kwargs: P.kwargs) -> None:
        f(*args, **kwargs)

    # This should generate an error because the concatenated parameters don't match.
    return inner


def decorator4(f: Callable[P, None]) -> Callable[Concatenate[str, P], None]:
    def inner(var: str, *args: P.args, **kwargs: P.kwargs) -> None:
        f(*args, **kwargs)

    return inner
