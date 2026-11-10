from collections.abc import Iterator
from typing import Any, Generic, Protocol, TypeVar, overload


T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)


class SupportsArray(Protocol[T_co]):
    def __array__(self) -> T_co: ...


class NestedSequence(Protocol[T_co]):
    def __len__(self, /) -> int: ...
    def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
    def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...


class ArrayResult(Generic[T]):
    pass


@overload
def array(value: SupportsArray[T] | NestedSequence[SupportsArray[T]]) -> ArrayResult[T]: ...
@overload
def array(value: object) -> ArrayResult[Any]: ...
def array(value: object) -> ArrayResult[Any]:
    return ArrayResult()


class ArrayImpl:
    def __array__(self) -> int:
        return 0


class CallableArray(ArrayImpl):
    def __call__(self, value: str) -> str:
        return value


@overload
def first(value: int) -> int: ...
@overload
def first(value: str) -> str: ...
def first(value: int | str) -> int | str:
    return value


@overload
def second(value: bytes) -> bytes: ...
@overload
def second(value: float) -> float: ...
def second(value: bytes | float) -> bytes | float:
    return value


reveal_type(array([first, second]), expected_text="ArrayResult[Any]")
reveal_type(array([second, first]), expected_text="ArrayResult[Any]")
reveal_type(array([ArrayImpl()]), expected_text="ArrayResult[int]")
reveal_type(array([CallableArray()]), expected_text="ArrayResult[int]")
reveal_type(array([[CallableArray()]]), expected_text="ArrayResult[int]")
reveal_type(array([first, ArrayImpl()]), expected_text="ArrayResult[Any]")