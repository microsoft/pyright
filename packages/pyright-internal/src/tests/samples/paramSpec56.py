# This sample tests a case derived from the wrapt 2.1.x stubs that
# previously caused pyright to hang. A function parameter is typed
# as a union of three generic Callable aliases, each parameterized
# with the same ParamSpec and TypeVar, and the argument is itself a
# generic Callable whose return type is a union (`R | Awaitable[R]`).
# Bidirectional inference must terminate (and not blow up
# combinatorially) on this case.

from collections.abc import Awaitable, Callable
from typing import Any, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R", covariant=True)

GenericCallableWrapperFunction = Callable[
    [Callable[P, R], Any, tuple[Any, ...], dict[str, Any]], R
]
ClassMethodWrapperFunction = Callable[
    [type[Any], Callable[P, R], Any, tuple[Any, ...], dict[str, Any]], R
]
InstanceMethodWrapperFunction = Callable[
    [Any, Callable[P, R], Any, tuple[Any, ...], dict[str, Any]], R
]
WrapperFunction = (
    GenericCallableWrapperFunction[P, R]
    | ClassMethodWrapperFunction[P, R]
    | InstanceMethodWrapperFunction[P, R]
)


def wrap_function_wrapper(
    target: str, name: str, wrapper: WrapperFunction[P, R]
) -> None: ...


def make_async_wrapper[**P1, R1]() -> Callable[
    [Callable[P1, R1], Any, tuple[Any, ...], dict[str, Any]], Awaitable[R1]
]: ...


def make_sync_wrapper[**P1, R1]() -> Callable[
    [Callable[P1, R1], Any, tuple[Any, ...], dict[str, Any]], R1
]: ...


def make_wrapper[**P1, R1](
    is_async: bool,
) -> Callable[
    [Callable[P1, R1], Any, tuple[Any, ...], dict[str, Any]], R1 | Awaitable[R1]
]:
    return make_async_wrapper() if is_async else make_sync_wrapper()


# This call must terminate. The constraint solver sees a cyclic
# constraint (R := R | Awaitable[R]) which has no finite solution,
# so it refuses to bind R and the call returns no useful inferred type.
# Analysis must not hang.
wrap_function_wrapper("example", "target", make_wrapper(False))
