# This sample tests error conditions for ParamSpec (PEP 612).

from typing import Any, Callable, List, ParamSpec, Tuple, cast


TParams = ParamSpec("TParams")

# This should generate an error because ParamSpecs
# can't be used as a type annotation.
def foo(a: TParams) -> int:
    return 1


a = 3

# This should generate an error.
b = cast(TParams, a)

foo(1)


def func1(x: Callable[TParams, Any]):
    # This should generate an error.
    c: List[TParams] = []

    d: Callable[TParams, int]

    # This should generate an error.
    e: Callable[TParams, TParams]

    # This should generate an error.
    f: Callable[[TParams], int]

    # This should generate an error.
    g: Tuple[TParams]
