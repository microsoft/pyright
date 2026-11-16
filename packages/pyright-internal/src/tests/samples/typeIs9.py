# This sample tests generic instance information in type(x) identity guards.

from collections.abc import Sequence
from typing import Any, Generic, TypeVar, assert_never, assert_type, final, overload


class Base[T]:
    def __init__(self, value: T):
        self.value = value


class Sub[T](Base[T]):
    pass


class Nested[T](Base[list[T]]):
    pass


class Deep[T](Nested[tuple[T, str]]):
    pass


class Extra[T, U](Base[T]):
    pass


def nested(value: Base[list[int]], expected: type[Nested[int]]):
    if type(value) is expected:
        assert_type(value, Nested[int])
        assert_type(value.value, list[int])
    else:
        assert_type(value, Base[list[int]])

    if expected is type(value):
        assert_type(value, Nested[int])
        assert_type(value.value, list[int])


def gradual_operand(value: Base[int], expected: type[Sub[Any]]):
    if type(value) is expected:
        assert_type(value, Sub[int])
        assert_type(value.value, int)


def nested_gradual_operand(value: Base[list[int]], expected: type[Nested[Any]]):
    if expected is type(value):
        assert_type(value, Nested[int])
        assert_type(value.value, list[int])


def deep(value: Base[list[tuple[int, str]]], expected: type[Deep[Any]]):
    if type(value) is expected:
        assert_type(value, Deep[int])


def extra(value: Base[int], expected: type[Extra[Any, str]]):
    if type(value) is expected:
        assert_type(value, Extra[int, str])


def partial(value: Base[tuple[Any, int]], expected: type[Sub[tuple[str, Any]]]):
    if type(value) is expected:
        assert_type(value, Sub[tuple[str, int]])


def partial_nested(value: Base[list[tuple[Any, int]]], expected: type[Sub[list[tuple[str, Any]]]]):
    if type(value) is expected:
        assert_type(value, Sub[list[tuple[str, int]]])


def invariant_nested(value: Base[tuple[object, int]], expected: type[Sub[tuple[str, Any]]]):
    if type(value) is expected:
        assert_type(value, Sub[tuple[object, int]])


SourcePair = tuple[Any, int]
HintPair = tuple[str, Any]
PrecisePair = tuple[str, int]


def shared_arguments(
    value: Base[tuple[SourcePair, SourcePair]],
    expected: type[Sub[tuple[HintPair, HintPair]]],
):
    if type(value) is expected:
        assert_type(value, Sub[tuple[PrecisePair, PrecisePair]])


def gradual_group(value: BaseException | BaseExceptionGroup[Any], expected: ExceptionGroup[ValueError]):
    if type(value) is type(expected):
        assert_type(value, ExceptionGroup[ValueError])
        assert_type(value.exceptions, tuple[ValueError | ExceptionGroup[ValueError], ...])


def unknown_group(value: BaseException, expected: ExceptionGroup[ValueError], grouped: bool):
    if grouped:
        assert isinstance(value, BaseExceptionGroup)
    if type(value) is type(expected):
        assert_type(value, ExceptionGroup[ValueError])
        assert_type(value.exceptions, tuple[ValueError | ExceptionGroup[ValueError], ...])


def class_object[C: type[int]](value: Any, expected: C) -> tuple[C, int]:
    if type(value) is expected:
        assert_type(value, int)
        return expected, value + 1
    else:
        assert_type(value, Any)
    return expected, 0


def reverse_class_object[C: type[int]](value: Any, expected: C) -> tuple[C, int]:
    if expected is type(value):
        assert_type(value, int)
        return expected, value + 1
    return expected, 0


def instance_typevar[T](value: Any, expected: type[T]) -> T:
    if type(value) is expected:
        assert_type(value, T)
        return value
    raise TypeError


@overload
def quote(value: str) -> str: ...


@overload
def quote(value: None) -> None: ...


def quote(value: str | None) -> str | None:
    return value


def query(value: str | Sequence[tuple[str, int]]) -> str | None:
    if type(value) is str or isinstance(value, str):
        assert_type(value, str)
        return quote(value)
    return None


def exact(value: str | Sequence[tuple[str, int]]):
    if type(value) is str:
        assert_type(value, str)
    else:
        assert_type(value, str | Sequence[tuple[str, int]])


Co = TypeVar("Co", covariant=True)
Contra = TypeVar("Contra", contravariant=True)


class Read(Generic[Co]):
    def get(self) -> Co:
        raise NotImplementedError


class ReadSub[T](Read[list[T]]):
    pass


class Sink(Generic[Contra]):
    def put(self, value: Contra) -> None:
        pass


class SinkSub[T](Sink[list[T]]):
    pass


def covariant(value: Read[list[int]], expected: type[ReadSub[Any]]):
    if type(value) is expected:
        assert_type(value, ReadSub[int])


def covariant_hint(value: Read[object], expected: type[ReadSub[int]]):
    if expected is type(value):
        assert_type(value, ReadSub[int])


def contravariant(value: Sink[list[int]], expected: type[SinkSub[Any]]):
    if type(value) is expected:
        assert_type(value, SinkSub[int])


@final
class Fixed(Base[int]):
    pass


def incompatible_fixed(value: Base[str], expected: type[Fixed]):
    if type(value) is Fixed:
        assert_never(value)
    if expected is type(value):
        assert_never(value)
