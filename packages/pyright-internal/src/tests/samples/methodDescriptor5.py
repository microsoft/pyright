# This sample tests inference recovery for invalid raw descriptor arguments.
# The argument errors must not erase the wrapped method's signature.

from typing import Any, Callable, Concatenate, Coroutine, ParamSpec, Self, TypeVar, assert_type

P = ParamSpec("P")
R = TypeVar("R")
C = TypeVar("C")


def dispatch(
    async_impl: Callable[P, Coroutine[Any, Any, R]]
    | classmethod[type[Any], P, Coroutine[Any, Any, R]],
) -> Callable[[Callable[P, R]], Callable[P, R | Coroutine[Any, Any, R]]]: ...


def descriptor_dispatch(
    async_impl: classmethod[C, P, Coroutine[Any, Any, R]],
) -> Callable[
    [Callable[Concatenate[type[C], P], R]],
    Callable[Concatenate[type[C], P], R | Coroutine[Any, Any, R]],
]: ...


class Factory:
    @classmethod
    async def aget(cls, key: str) -> Self:
        return cls()

    @classmethod
    @dispatch(aget)  # The descriptor's receiver is not type[Any].
    def get(cls, key: str) -> Self:
        return cls()

    @classmethod
    @descriptor_dispatch(aget)
    def good(cls, key: str) -> Self:
        return cls()

    aget("key")  # Raw classmethods remain non-callable.


class Child(Factory): ...


assert_type(Factory.get("key"), Factory | Coroutine[Any, Any, Factory])
assert_type(Child.get("key"), Child | Coroutine[Any, Any, Child])
assert_type(Child.good("key"), Child | Coroutine[Any, Any, Child])
Child.get(123)  # The recovered signature still requires str.
Child.get("key", _sync=True)  # The recovered signature is not (...).


class Artifact:
    data: dict[str, Any] | None = None

    @classmethod
    async def aget(cls, key: str) -> Self | None:
        return cls()

    @classmethod
    @dispatch(aget)  # The invalid descriptor argument must still be reported.
    def get(cls, key: str) -> Self | None:
        return cls()


assert_type(
    Artifact.get("key"),
    Artifact | None | Coroutine[Any, Any, Artifact | None],
)


async def consume() -> None:
    result = await Artifact.get("key")  # Artifact and None are not awaitable.
    result.data.startswith("prefix")  # Retain member and optional diagnostics.
    if "key" in result.data:  # Retain the invalid optional operand diagnostic.
        pass


async def explicit_impl(cls: type[Factory], key: str) -> Factory:
    return cls()


dispatch(classmethod(explicit_impl))  # Nominal receiver invariance still applies.


def callback(fn: Callable[P, R]) -> Callable[P, R]: ...


class Callbacks:
    @classmethod
    def method(cls, key: str) -> int:
        return len(key)

    callback(method)  # A raw classmethod is still not Callable.

    @staticmethod
    def static(key: str) -> int:
        return len(key)

    wrapped = staticmethod(callback(static))


assert_type(Callbacks.wrapped("key"), int)
Callbacks.wrapped(123)  # Staticmethod argument errors remain checked.
assert_type(callback(Callbacks.method)("key"), int)
