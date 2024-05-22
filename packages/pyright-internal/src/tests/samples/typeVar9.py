# This sample tests the reporting of incorrect TypeVar usage within
# a generic function. A TypeVar must appear at least twice to be
# considered legitimate.

# pyright: reportInvalidTypeVarUse=true

from typing import AnyStr, Callable, Generic, overload
from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]


_T = TypeVar("_T")
_S = TypeVar("_S")


class A(Generic[_T]):
    def m1(self, v1: _T) -> None: ...

    # This should generate an error because _S
    # is a local typeVar and appears only once.
    def m2(self, v1: _S) -> None: ...

    # This should generate an error because _S
    # is a local typeVar and appears only once.
    def m3(self, v1: _T) -> _S: ...


# This should generate an error because _T
# is a local typeVar and appears only once.
def f1(v1: _T) -> None: ...


def f2(v1: _T, v2: list[_T]) -> None: ...


def f3(v1: _T) -> _T: ...


def f4() -> dict[_T, _T]: ...


# This should generate an error because _T
# is a local typeVar and appears only once.
def f5() -> list[_T]: ...


_T_Bound = TypeVar("_T_Bound", bound=int)
_T_Constrained = TypeVar("_T_Constrained", int, str)


# Constrained TypeVars are exempt.
def f6(v1: _T_Constrained): ...


# Bound TypeVars are not exempt.
def f7(v1: _T_Bound): ...


# Bound TypeVars as type arguments are exempt when used in an
# input parameter annotation.
def f8(v1: list[_T_Bound]): ...


# Bound TypeVars as type arguments are not exempt when used in a
# return annotation.
def f9() -> list[_T_Bound]: ...


# TypeVars used as type args to a generic type alias are exempt.
MyCallable = Callable[[_T], _T]


def f10() -> MyCallable[_T]: ...


# This should generate an error because AnyStr can go unsolved.
def f11(x: AnyStr = ...) -> AnyStr: ...


# This should generate an error because AnyStr can go unsolved.
def f12(x: AnyStr = ...) -> list[AnyStr]: ...


def f13(x: AnyStr = ...) -> AnyStr | None: ...


def f14(x: AnyStr = "") -> AnyStr: ...


# This should generate an error because AnyStr can go unsolved.
def f15(x: AnyStr = ...) -> list[AnyStr] | None: ...


class B(Generic[AnyStr]):
    # This should generate an error because AnyStr can go unsolved.
    def __init__(self, *, mode: AnyStr = ...) -> None: ...


class C(Generic[AnyStr]):
    def __init__(self, *, mode: AnyStr = "") -> None: ...


@overload
def f16(default: int = ...) -> list[int]: ...


@overload
def f16(default: _T) -> list[_T]: ...


def f16(default: _T = ...) -> list[int] | list[_T]: ...


class ClassA(Generic[_T]):
    # This should generate an error because _T can go unsolved.
    def __init__(self, x: _T = ...) -> None: ...


_T2 = TypeVar("_T2", default=int)


class ClassB(Generic[_T2]):
    def __init__(self, x: _T2 = ...) -> None: ...


# This should generate an error because _T appears only once.
def f17(
    arg,  # type: _T
):  # type: (...) -> int
    return 1


def f18(
    arg,  # type: _T
):  # type: (...) -> _T
    return arg


# This should generate an error because _T appears only once.
def f19(
    arg,
):  # type: (_T) -> int
    return 1


def f20(
    arg,  # type: _T
):  # type: (...) -> _T
    return arg
