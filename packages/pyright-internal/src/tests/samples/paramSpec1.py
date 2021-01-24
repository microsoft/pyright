# This sample tests error conditions for ParamSpec (PEP 612).

from typing import Callable, Concatenate, List, ParamSpec, Tuple, cast


TParams = ParamSpec("TParams")

# This should generate an error because ParamSpecs
# can't be used as a type annotation.
def foo(a: TParams) -> int:
    return 1


a = 3

# This should generate an error.
b = cast(TParams, a)

foo(1)

# This should generate an error.
c: List[TParams] = []

d: Callable[TParams, int]

# This should generate an error.
e: Callable[TParams, TParams]

# This should generate an error.
f: Callable[[TParams], int]

# This should generate an error.
g: Tuple[TParams]


def add(f: Callable[TParams, int]) -> Callable[Concatenate[str, TParams], None]:
    def func1(
        s: str, *args: TParams.args, **kwargs: TParams.kwargs
    ) -> None:  # Accepted
        pass

    # Parameter 's' and 't' should generate an error according to PEP 612
    def func2(
        *args: TParams.args, s: str, t: int, **kwargs: TParams.kwargs
    ) -> None:  # Rejected
        pass

    return func1  # Accepted


def remove(f: Callable[Concatenate[int, TParams], int]) -> Callable[TParams, None]:
    def foo(*args: TParams.args, **kwargs: TParams.kwargs) -> None:
        f(1, *args, **kwargs)  # Accepted

        # Should generate an error because positional parameter
        # after *args is not allowed.
        f(*args, 1, **kwargs)  # Rejected

        # Should generate an error because positional parameter
        # is missing.
        f(*args, **kwargs)  # Rejected

    return foo
