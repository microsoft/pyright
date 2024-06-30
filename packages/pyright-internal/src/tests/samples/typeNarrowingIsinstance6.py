# This sample tests the case where isinstance or issubclass is used to
# narrow the type of a specialized class to a subclass where the type
# arguments are implied by the type arguments of the wider class.

from typing import Any, Generic, Iterable, Sequence, TypeVar

_T1 = TypeVar("_T1")


class ParentA(Generic[_T1]): ...


class ChildA1(ParentA[_T1]): ...


def func1(a: ParentA[int], b: ParentA[str] | ParentA[complex]) -> None:
    if isinstance(a, ChildA1):
        reveal_type(a, expected_text="ChildA1[int]")

    if isinstance(b, ChildA1):
        reveal_type(b, expected_text="ChildA1[str] | ChildA1[complex]")


def func2(
    a: type[ParentA[int]], b: type[ParentA[str]] | type[ParentA[complex]]
) -> None:
    if issubclass(a, ChildA1):
        reveal_type(a, expected_text="type[ChildA1[int]]")

    if issubclass(b, ChildA1):
        reveal_type(b, expected_text="type[ChildA1[str]] | type[ChildA1[complex]]")


def func3(value: Iterable[_T1]) -> Sequence[_T1] | None:
    if isinstance(value, Sequence):
        return value


_T2 = TypeVar("_T2", bound=float, covariant=True)


class ParentB(Generic[_T2]):
    pass


class ChildB1(ParentB[_T2]):
    pass


def func4(var: ParentB[int]):
    if isinstance(var, ChildB1):
        reveal_type(var, expected_text="ChildB1[int]")


def func5(var: ParentB[Any]):
    if isinstance(var, ChildB1):
        reveal_type(var, expected_text="ChildB1[Any]")


_T3 = TypeVar("_T3", float, str)


class ParentC(Generic[_T3]):
    pass


class ChildC1(ParentC[_T3]):
    pass


def func6(var: ParentC[int]):
    if isinstance(var, ChildC1):
        reveal_type(var, expected_text="ChildC1[float]")


class ParentD(Generic[_T1]):
    x: _T1


class ChildD1(ParentD[_T1]): ...


class ChildD2(ParentD[int]): ...


def func7(a: ParentD[_T1]) -> _T1 | None:
    if isinstance(a, ChildD1):
        reveal_type(a, expected_text="ChildD1[_T1@func7]")

    elif isinstance(a, ChildD2):
        reveal_type(a, expected_text="ChildD2")
