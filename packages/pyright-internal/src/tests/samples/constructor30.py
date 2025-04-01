# This sample tests the case where a class is parameterized by a ParamSpec
# which is inferred by a call to the constructor, and the passed value
# is a generic function whose types are informed by additional parameters
# also passed to the constructor.

from typing import Callable, Generic, ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")


class ABase: ...


class A(ABase): ...


TA = TypeVar("TA", bound=ABase)


class B(Generic[P, T]):
    def __init__(
        self, _type: Callable[P, T], *args: P.args, **kwargs: P.kwargs
    ) -> None: ...


def func1(t: type[TA]) -> TA: ...


b = B(func1, A)
reveal_type(b, expected_text="B[(t: type[A]), A]")


class C(Generic[TA]):
    def __init__(self, _type: type[TA]) -> None: ...


c = B(C, A)
reveal_type(c, expected_text="B[(_type: type[A]), C[A]]")
