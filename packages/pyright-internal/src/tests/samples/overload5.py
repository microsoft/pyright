# This sample tests the type checker's detection of overlapping
# overload declarations.

from typing import Any, Generic, Optional, Tuple, TypeVar, overload


@overload
def func1(a: float, b: Optional[float], c: Optional[bool] = None) -> int:
    return 1


# This should generate an error because the overload is obscured.
@overload
def func1(a: int, b: int) -> int:
    return 1


@overload
def func1(a: int, b: int, *, named: int = 3) -> int:
    return 1


# This should generate an error because the overload is obscured.
@overload
def func1(a: int, b: int, *, named: int) -> int:
    return 1


@overload
def func1(a: complex, b: int) -> int:
    return 1


@overload
def func2(a: int, b: Any) -> int:
    return 1


# This should generate an error because the overload is obscured.
@overload
def func2(a: int, b: int) -> int:
    return 1


@overload
def func3(a: int, b: int) -> int:
    return 1


@overload
def func3(a: int, b: int, **c: Any) -> int:
    return 1


@overload
def func3(a: int, b: Any) -> int:
    return 1


@overload
def func4(a: int, *, c: int, b: int) -> int:
    return 1


# This should generate an error because the overload is obscured.
@overload
def func4(a: int, *, b: int, c: int) -> int:
    return 1


# This should generate an error because the overload is overlapping
# in an unsafe way (i.e. returns an incompatible type).
@overload
def func5(a: int, b: int) -> int:
    return 3


@overload
def func5(a: float, b: float = 3.4, *c: int, d: float = 4.5) -> str:
    return ""


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


class GenericClass(Generic[_T1, _T2]):
    @overload
    def method1(a: _T1, b: Tuple[_T2, ...]) -> int:
        return 1

    @overload
    def method1(a: _T1, b: Tuple[Any, ...]) -> int:
        return 1

    @overload
    def method2(a: _T2, b: int) -> int:
        return 1

    @overload
    def method2(a: _T1, b: _T2) -> int:
        return 1
