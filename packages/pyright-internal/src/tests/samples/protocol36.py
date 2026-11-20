# This sample tests the handling of nested protocols.

from collections.abc import Callable, Iterator
from typing import Any, Protocol, TypeVar, overload

_T_co = TypeVar("_T_co", covariant=True)
_T_constrained = TypeVar("_T_constrained", int, str)
_T_array = TypeVar("_T_array", bound="SupportsArray")


class NestedSequence(Protocol[_T_co]):
    @overload
    def __getitem__(self, __i: int) -> _T_co | "NestedSequence[_T_co]": ...

    @overload
    def __getitem__(self, __s: slice) -> "NestedSequence[_T_co]": ...


def func(v1: list[list[list[int]]]):
    a: NestedSequence[int] = v1
    b: NestedSequence[int] = [[[3, 4]]]


class SupportsArray(Protocol):
    def __array__(self) -> object: ...


class FullNestedSequence(Protocol[_T_co]):
    def __len__(self, /) -> int: ...

    def __getitem__(self, index: int, /) -> _T_co | "FullNestedSequence[_T_co]": ...

    def __contains__(self, value: object, /) -> bool: ...

    def __iter__(self, /) -> Iterator[_T_co | "FullNestedSequence[_T_co]"]: ...

    def __reversed__(self, /) -> Iterator[_T_co | "FullNestedSequence[_T_co]"]: ...

    def count(self, value: Any, /) -> int: ...

    def index(self, value: Any, /) -> int: ...


def func2(v1: list[list[int]], v2: list[Callable[[], int]]):
    a: FullNestedSequence[int] = v1

    # This should generate an error because function values do not
    # implement SupportsArray and are not recursively nested sequences.
    b: FullNestedSequence[SupportsArray] = v2


class SequenceNamedProtocol(Protocol[_T_co]):
    def __len__(self, /) -> int: ...

    def __getitem__(self, index: int, /) -> object: ...

    def __iter__(self, /) -> Iterator[object]: ...


def func3(v: list[Callable[[], int]]):
    # Sequence-like member names alone do not imply that the type parameter
    # describes the element returned by __getitem__ or __iter__.
    a: SequenceNamedProtocol[int] = v


def func4(
    callback: Callable[[int], int]
    | Callable[[FullNestedSequence[SupportsArray]], int]
    | Callable[[list[str]], int],
    value: list[Callable[[], int]],
):
    # This should generate an error that identifies the incompatible __getitem__
    # even though the protocol callable is checked in a speculative union branch.
    callback(value)


def constrained_value(
    value: _T_constrained, sequence: FullNestedSequence[_T_constrained]
) -> _T_constrained:
    return value


def func5(
    values: tuple[int, ...],
    empty: tuple[()],
    nested_any: tuple[tuple[Any, Any], tuple[Any, Any]],
):
    reveal_type(constrained_value(1, [1, 2]), expected_text="int")

    # This should generate an error because the first argument constrains the
    # protocol element type to str.
    constrained_value("", [1, 2])

    valid_heterogeneous: FullNestedSequence[int | str] = (1, "")
    valid_unbounded: FullNestedSequence[int] = values
    valid_empty: FullNestedSequence[int] = empty

    # Fixed tuples containing Any must use normal protocol matching. Reducing
    # their element types can be stricter than the overloaded tuple __getitem__.
    valid_nested_any: FullNestedSequence[SupportsArray] = nested_any

    # This should generate an error because neither tuple element satisfies
    # the recursive protocol element type.
    invalid_heterogeneous: FullNestedSequence[SupportsArray] = (lambda: 1, lambda: 2)


class ArrayImpl:
    def __array__(self) -> object:
        return object()


def preserve_array_subtype(
    sequence: FullNestedSequence[_T_array], fallback: _T_array
) -> _T_array:
    return fallback


reveal_type(preserve_array_subtype([ArrayImpl()], ArrayImpl()), expected_text="ArrayImpl")


class OverloadedNestedSequence(FullNestedSequence[_T_co], Protocol[_T_co]):
    @overload
    def __getitem__(self, index: int, /) -> _T_co | "OverloadedNestedSequence[_T_co]": ...

    @overload
    def __getitem__(self, index: slice, /) -> "OverloadedNestedSequence[_T_co]": ...


def func6(value: list[int]):
    # An overloaded __getitem__ is outside the fast-path proof and must fall
    # back to normal structural protocol matching.
    sequence: OverloadedNestedSequence[int] = value


def func7(invalid: list[Callable[[], int]], valid: list[list[int]]):
    # This should generate an error, but it must not cache list as universally
    # incompatible with other specializations of the recursive protocol.
    invalid_sequence: FullNestedSequence[SupportsArray] = invalid
    valid_sequence: FullNestedSequence[int] = valid
