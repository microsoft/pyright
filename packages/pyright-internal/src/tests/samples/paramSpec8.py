# This sample tests error conditions for ParamSpec (PEP 612).

from typing import Callable, Concatenate, ParamSpec

P = ParamSpec("P")


def add(f: Callable[P, int]) -> Callable[Concatenate[str, P], None]:
    def func1(s: str, *args: P.args, **kwargs: P.kwargs) -> None:  # Accepted
        pass

    # Parameter 's' and 't' should generate an error according to PEP 612
    def func2(*args: P.args, s: str, t: int, **kwargs: P.kwargs) -> None:  # Rejected
        pass

    return func1  # Accepted


def remove(f: Callable[Concatenate[int, P], int]) -> Callable[P, None]:
    def foo(*args: P.args, **kwargs: P.kwargs) -> None:
        f(1, *args, **kwargs)  # Accepted

        # Should generate an error because positional parameter
        # after *args is not allowed.
        f(*args, 1, **kwargs)  # Rejected

        # Should generate an error because positional parameter
        # is missing.
        f(*args, **kwargs)  # Rejected

    return foo


def outer(f: Callable[P, None]) -> Callable[P, None]:
    def foo(x: int, *args: P.args, **kwargs: P.kwargs) -> None:
        f(*args, **kwargs)

    def bar(*args: P.args, **kwargs: P.kwargs) -> None:
        foo(1, *args, **kwargs)  # Accepted

        # This should generate an error because keyword parameters
        # are not allowed in this situation.
        foo(x=1, *args, **kwargs)  # Rejected

    return bar
