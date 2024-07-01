# This sample tests the handling of nested calls to generic functions
# when bidirectional type inference is involved.

from typing import Any, Callable, Generic, Literal, ParamSpec, Protocol, TypeVar

_T = TypeVar("_T")
_P = ParamSpec("_P")


def identity1(x: _T) -> _T:
    return x


def identity2(x: _T) -> _T:
    return x


def test1(x: Literal[2]) -> Literal[2]:
    return identity1(identity2(x))


v1 = min(1, max(2, 0.5))
reveal_type(v1, expected_text="float")


class Future(Generic[_T]): ...


def func1(future: Future[_T]) -> Future[_T]: ...


def func2(
    __fn: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
) -> Future[_T]: ...


def func3() -> int: ...


def func4(a: int, b: int) -> str: ...


reveal_type(func1(func2(func3)), expected_text="Future[int]")
reveal_type(func1(func2(func4, 1, 2)), expected_text="Future[str]")
reveal_type(func1(func2(func4, a=1, b=2)), expected_text="Future[str]")


class Proto(Protocol):
    def __call__(self, func: _T) -> _T: ...


def func5(cb: Proto, names: Any):
    val1 = cb(cb(names))
    reveal_type(val1, expected_text="Any")

    val2 = cb(cb(1))
    reveal_type(val2, expected_text="int")
