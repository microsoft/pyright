# This sample tests error conditions for ParamSpec (PEP 612).

from typing import Any, Callable, ParamSpec, Protocol, cast

P = ParamSpec("P")


# This should generate an error because ParamSpecs
# can't be used as a type annotation.
def func1(a: P) -> int:
    return 1


a = 3

# This should generate an error.
b = cast(P, a)

func1(1)


def func2(x: Callable[P, Any]):
    # This should generate an error.
    c: list[P] = []

    d: Callable[P, int]

    # This should generate an error.
    e: Callable[P, P]

    # This should generate an error.
    f: Callable[[P], int]

    # This should generate an error.
    g: tuple[P]


class SomeWrapper(Protocol[P]):
    def __call__(self, *args: P.args, **kwargs: P.kwargs): ...


# This should generate an error because P cannot be used with other
# type arguments.
def func3(x: SomeWrapper[P, int]):
    pass


# This should generate an error because P cannot be used with other
# type arguments.
def func4(x: SomeWrapper[[P, int]]):
    pass


def func5(x: SomeWrapper[P]):
    pass


# This form is considered an error.
def func6(x: SomeWrapper[[P]]):
    pass
