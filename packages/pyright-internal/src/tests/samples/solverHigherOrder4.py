# This sample tests the handling of generic callbacks passed to a higher-order
# function that is also generic.

from typing import Callable, ParamSpec, Protocol, TypeVar

_T = TypeVar("_T")
_T1 = TypeVar("_T1")
_T_co = TypeVar("_T_co", covariant=True)
_U = TypeVar("_U")


class MyIterable(Protocol[_T_co]): ...


class MySupportsAbs(Protocol[_T_co]): ...


def my_abs(x: MySupportsAbs[_T], /) -> _T: ...


def my_map(a: Callable[[_T], _U], b: MyIterable[_T]) -> MyIterable[_U]: ...


def func1(xs: MyIterable[MySupportsAbs[int]]):
    ys0 = my_map(a=my_abs, b=xs)
    reveal_type(ys0, expected_text="MyIterable[int]")

    ys1 = my_map(b=xs, a=my_abs)
    reveal_type(ys1, expected_text="MyIterable[int]")


def ident(x: _U) -> _U:
    return x


def func2(__cb: Callable[[_T1], _T], __arg0: _T1) -> _T: ...


x1_0 = func2(ident, "hi")
reveal_type(x1_0, expected_text="str")

x1_1 = func2(ident, 1)
reveal_type(x1_1, expected_text="int")


_P = ParamSpec("_P")
_R = TypeVar("_R")


def func3(__obj: Callable[_P, _R], *args: _P.args, **kwargs: _P.kwargs) -> _R: ...


x2_0 = func3(ident, "hi")
reveal_type(x2_0, expected_text="str")

x2_1 = func3(ident, 1)
reveal_type(x2_1, expected_text="int")
