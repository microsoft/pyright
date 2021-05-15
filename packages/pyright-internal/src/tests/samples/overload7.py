# This sample tests the verification that overload implementation signatures
# are a superset of their associated overload signatures.

from typing import (
    Any,
    Dict,
    Generic,
    List,
    Literal,
    Optional,
    TypeVar,
    Union,
    overload,
)

# This should generate an error because its input parameter
# type is incompatible.
@overload
def func1(a: int) -> str:
    ...


# This should generate an error because its return parameter
# type is incompatible.
@overload
def func1(a: str) -> int:
    ...


def func1(a: str) -> str:
    return a


# This should generate an error because the parameter "b" is missing
# from the implementation.
@overload
def func2(a: int, b: str = ...) -> str:
    ...


@overload
def func2(a: None) -> str:
    ...


def func2(a: Optional[int]) -> str:
    ...


@overload
def func3(a: int, *, b: Literal["r"]) -> str:
    ...


@overload
def func3(a: int, *, b: Literal["b"]) -> bytes:
    ...


def func3(*args: Any, **kwargs: Any) -> Any:
    ...


_T = TypeVar("_T")


@overload
def func4(a: None) -> None:
    ...


@overload
def func4(a: List[_T]) -> _T:
    ...


def func4(a: Optional[List[_T]]) -> Optional[_T]:
    ...


class A:
    @overload
    def method4(self, a: None) -> None:
        ...

    @overload
    def method4(self, a: List[_T]) -> _T:
        ...

    def method4(self, a: Optional[List[_T]]) -> Optional[_T]:
        ...


@overload
def func5(a: List[_T]) -> _T:
    ...


@overload
def func5(a: None) -> None:
    ...


# This should generate an error because List is not compatible with Dict.
def func5(a: Optional[Dict[Any, Any]]) -> Optional[Any]:
    ...


@overload
def func6(foo: int, /) -> int:
    ...


@overload
def func6(bar: str, /) -> int:
    ...


def func6(p0: Union[int, str], /) -> int:
    return 3


T = TypeVar("T")


class ClassA(Generic[T]):
    @overload
    def method1(self: "ClassA[None]") -> None:
        ...

    @overload
    def method1(self, value: T) -> None:
        ...

    def method1(self, value: Any = None) -> None:
        ...
