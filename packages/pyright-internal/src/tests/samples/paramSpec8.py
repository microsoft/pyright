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
    def func1(*args: P.args, **kwargs: P.kwargs) -> None:
        f(1, *args, **kwargs)  # Accepted

        # Should generate an error because positional parameter
        # after *args is not allowed.
        f(*args, 1, **kwargs)  # Rejected

        # Should generate an error because positional parameter
        # is missing.
        f(*args, **kwargs)  # Rejected

    return func1


def outer(f: Callable[P, None]) -> Callable[P, None]:
    def func1(x: int, *args: P.args, **kwargs: P.kwargs) -> None:
        f(*args, **kwargs)

    def func2(*args: P.args, **kwargs: P.kwargs) -> None:
        func1(1, *args, **kwargs)  # Accepted

        # This should generate an error because keyword parameters
        # are not allowed in this situation.
        func1(x=1, *args, **kwargs)  # Rejected

        # This should generate an error because *args is duplicated.
        func1(1, *args, *args, **kwargs)

        # This should generate an error because **kwargs is duplicated.
        func1(1, *args, **kwargs, **kwargs)

    return func2
