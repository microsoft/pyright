# This sample tests error conditions for ParamSpec (PEP 612).

from typing import Any, Callable, List, ParamSpec, Protocol, Tuple, cast


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


P = ParamSpec("P")


class SomeWrapper(Protocol[P]):
    def __call__(self, *args: P.args, **kwargs: P.kwargs):
        ...


# This should generate an error because P cannot be used with other
# type arguments.
def func2(x: SomeWrapper[P, int]):
    pass


# This should generate an error because P cannot be used with other
# type arguments.
def func3(x: SomeWrapper[[P, int]]):
    pass


def func4(x: SomeWrapper[P]):
    pass


# This form is considered an error.
def func5(x: SomeWrapper[[P]]):
    pass
