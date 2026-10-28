# This sample tests recovery from invalid overloaded descriptor arguments without
# narrowing the decorated implementation to the first overload.

from typing import Any, Callable, Coroutine, Generic, ParamSpec, Self, TypeVar, assert_type, overload
from uuid import UUID

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T", bound=str | int | None)


def dispatch(
    async_impl: Callable[P, Coroutine[Any, Any, R]]
    | classmethod[type[Any], P, Coroutine[Any, Any, R]],
) -> Callable[[Callable[P, R]], Callable[P, R | Coroutine[Any, Any, R]]]: ...


class Automation:
    @overload
    @classmethod
    async def aread(cls, id: UUID, name: str | None = ...) -> Self: ...
    @overload
    @classmethod
    async def aread(cls, id: None = None, name: str = ...) -> Self: ...
    @classmethod
    async def aread(cls, id: UUID | None = None, name: str | None = None) -> Self:
        return cls()

    @overload
    @classmethod
    async def read(cls, id: UUID, name: str | None = ...) -> Self: ...
    @overload
    @classmethod
    async def read(cls, id: None = None, name: str = ...) -> Self: ...
    @classmethod
    @dispatch(aread)  # The invalid descriptor argument must still be reported.
    def read(cls, id: UUID | None = None, name: str | None = None) -> Self:
        return cls()


class Child(Automation): ...


class Variable(Generic[T]):
    @overload
    @classmethod
    async def aget(cls, name: str) -> T | None: ...
    @overload
    @classmethod
    async def aget(cls, name: str, default: T) -> T: ...
    @classmethod
    async def aget(cls, name: str, default: str | int | None = None) -> str | int | None:
        return default

    @overload
    @classmethod
    def get(cls, name: str) -> T | None: ...
    @overload
    @classmethod
    def get(cls, name: str, default: T) -> T: ...
    @classmethod
    @dispatch(aget)  # Recovery must retain the optional default parameter.
    def get(cls, name: str, default: str | int | None = None) -> str | int | None:
        return default


uid = UUID(int=0)


async def consume() -> None:
    assert_type(await Automation.read(uid), Automation)
    assert_type(await Automation.read(name="name"), Automation)
    assert_type(await Child.read(uid), Child)
    assert_type(await Child.read(None, "name"), Child)
    assert_type(await Child.read(name="name"), Child)


assert_type(Variable[str].get("key"), str | None)
assert_type(Variable[str].get("key", "fallback"), str)
assert_type(Variable[str].get("key", default="fallback"), str)
assert_type(Variable[int].get("key"), int | None)
assert_type(Variable[int].get("key", 123), int)

Automation.read(123)  # No public overload accepts int.
Variable[str].get("key", 123)  # The default must match the specialization.
Variable[str].get("key", "fallback", 123)  # No overload accepts a third argument.


def preserve(fn: Callable[P, R]) -> Callable[P, R]: ...


@overload
def choose(value: int) -> int: ...
@overload
def choose(value: str) -> str: ...
def choose(value: int | str) -> int | str:
    return value


preserved = preserve(choose)
assert_type(preserved(1), int)
assert_type(preserved("text"), str)
preserved(None)  # Ordinary overload validation must not change.


class InvalidImplementation:
    @overload
    @classmethod
    def method(cls, value: int) -> int: ...
    @overload
    @classmethod
    def method(cls, value: str, extra: int) -> str: ...
    @classmethod
    def method(cls, value: int | str) -> int | str:
        return value  # The second overload is genuinely inconsistent.
