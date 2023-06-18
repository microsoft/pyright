# This sample tests a complex generic type alias that uses ParamSpecs
# and several layers of nested type aliases.

from typing import Any, Callable, Concatenate, Coroutine, TypeVar, Union
from typing_extensions import ParamSpec

T = TypeVar("T")
U = TypeVar("U")
P = ParamSpec("P")


Method = Callable[Concatenate[T, P], U]
MaybeMethod = Union[Method[T, P, U], Callable[P, U]]
Coro = Coroutine[Any, Any, T]
MaybeCoro = Union[T, Coro[T]]
CoroFunc = Callable[P, Coro[T]]
CoroMethod = Method[T, P, Coro[U]]
CoroMaybeMethod = Union[CoroMethod[T, P, U], CoroFunc[P, U]]


class D:
    ...


class E(Exception):
    ...


class F:
    ...


DT = TypeVar("DT", bound=D)

Error = CoroMaybeMethod[DT, [F, E], Any]
reveal_type(
    Error,
    expected_text="type[(DT@Error, F, E) -> Coroutine[Any, Any, Any]] | type[(F, E) -> Coroutine[Any, Any, Any]]",
)


class A:
    ...


class B:
    ...


class C:
    ...


BT = TypeVar("BT", bound=B)


Something = CoroMaybeMethod[A, [BT, C], Any]
reveal_type(
    Something,
    expected_text="type[(A, BT@Something, C) -> Coroutine[Any, Any, Any]] | type[(BT@Something, C) -> Coroutine[Any, Any, Any]]",
)
