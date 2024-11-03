# This sample tests the verification that overload implementation signatures
# are a superset of their associated overload signatures.

from typing import (
    Any,
    Awaitable,
    Callable,
    Generic,
    Iterable,
    Literal,
    NoReturn,
    TypeVar,
    overload,
)

T = TypeVar("T")


@overload
def func1(a: int) -> str: ...


@overload
def func1(a: str) -> int: ...


# This should generate two errors:
# The first is because of an incompatibility with overload 1
# because the input parameter type is incompatible.
# This second is because of an incompatibility with overload 2
# because the return type is incompatible.
def func1(a: str) -> str:
    return a


@overload
def func2(a: int, b: str = ...) -> str: ...


@overload
def func2(a: None) -> str: ...


# This should generate an error because the parameter "b" is missing
# from the implementation but is required by overload 1.
def func2(a: int | None) -> str: ...


@overload
def func3(a: int, *, b: Literal["r"]) -> str: ...


@overload
def func3(a: int, *, b: Literal["b"]) -> bytes: ...


def func3(*args: Any, **kwargs: Any) -> Any: ...


@overload
def func4(a: None) -> None: ...


@overload
def func4(a: list[T]) -> T: ...


def func4(a: list[T] | None) -> T | None: ...


class ClassA:
    @overload
    def method4(self, a: None) -> None: ...

    @overload
    def method4(self, a: list[T]) -> T: ...

    def method4(self, a: list[T] | None) -> T | None: ...


@overload
def func5(a: list[T]) -> T: ...


@overload
def func5(a: None) -> None: ...


# This should generate an error because list is not compatible with dict.
def func5(a: dict[Any, Any] | None) -> Any | None: ...


@overload
def func6(foo: int, /) -> int: ...


@overload
def func6(bar: str, /) -> int: ...


def func6(p0: int | str, /) -> int:
    return 3


class ClassB(Generic[T]):
    @overload
    def method1(self: "ClassB[None]") -> None: ...

    @overload
    def method1(self, value: T) -> None: ...

    def method1(self, value: Any = None) -> None: ...


class ClassC: ...


class ClassD: ...


T_CD = TypeVar("T_CD", ClassC, ClassD)


@overload
def func7(cls: type[ClassC], var: int) -> ClassC: ...


@overload
def func7(cls: type[ClassD], var: str) -> ClassD: ...


def func7(cls: type[T_CD], var: int | str) -> T_CD:
    return cls()


T_str = TypeVar("T_str", bound=str)


@overload
def func8(foo: int) -> int: ...


@overload
def func8(foo: T_str) -> tuple[T_str]: ...


def func8(foo: T_str | int) -> tuple[T_str] | int: ...


class ClassE: ...


T_E = TypeVar("T_E", bound=ClassE)


@overload
def func9() -> None: ...


@overload
def func9(bar: T_E) -> T_E: ...


def func9(bar: T_E | None = None) -> T_E | None:
    raise NotImplementedError


T_int_str = TypeVar("T_int_str", int, str)


@overload
def func10(option: Literal["a"], var: str) -> str: ...


@overload
def func10(option: Literal["b"], var: int) -> str: ...


# This should generate an error.
def func10(option: Literal["a", "b"], var: T_int_str) -> T_int_str: ...


class ClassF: ...


T_F = TypeVar("T_F", bound=type[ClassF])


@overload
def func11(var: T_F) -> T_F: ...


@overload
def func11(var: int) -> int: ...


def func11(var: T_F | int) -> T_F | int: ...


T7 = TypeVar("T7")
T8 = TypeVar("T8")
T9 = TypeVar("T9")


@overload
def func12(
    func: Callable[[T7], T8], iterable: Iterable[T7], default_value: None = None, /
) -> Iterable[T8 | None]: ...


@overload
def func12(
    func: Callable[[T7], T8], iterable: Iterable[T7], /, default_value: T9
) -> Iterable[T8 | T9]: ...


def func12(
    func: Callable[[T7], T8],
    iterable: Iterable[T7],
    /,
    default_value: T9 = None,
) -> Iterable[T8 | T9]: ...


@overload
def func13(x: int) -> NoReturn: ...


@overload
def func13(x: str) -> str | NoReturn: ...


def func13(x: int | str) -> str: ...


class ClassG(Generic[T]): ...


@overload
def func14(target: Callable[..., Awaitable[T]]) -> ClassG[T]: ...


@overload
def func14(target: Callable[..., T]) -> ClassG[T]: ...


def func14(
    target: Callable[..., Awaitable[T]] | Callable[..., T],
) -> ClassG[T]: ...


@overload
def func15(client_id: str, client_secret: str, /) -> None: ...


@overload
def func15(client_id: str, client_secret: str) -> None: ...


# This should generate an error because some of the keyword arguments are not present.
def func15(*creds: str) -> None:
    pass
