# This sample tests unsafe protocol overlap in class patterns.

from typing import Protocol, TypeVar, runtime_checkable
from typing_extensions import assert_type  # pyright: ignore[reportMissingModuleSource]


@runtime_checkable
class ReturnsInt(Protocol):
    def method(self) -> int: ...


class Wrong:
    def method(self) -> str:
        return "wrong"


class Correct:
    def method(self) -> int:
        return 1


def test_overlap(value: Wrong) -> None:
    match value:
        # This should generate an error because the protocol overlaps unsafely.
        case ReturnsInt():
            assert_type(value.method(), str)

    # This should generate the same unsafe-overlap error.
    if isinstance(value, ReturnsInt):
        assert_type(value.method(), str)


def test_guard(value: Wrong, condition: bool) -> None:
    match value:
        # This should generate an error because a guard does not make the overlap safe.
        case ReturnsInt() if condition:
            pass


def test_union(value: Wrong | Correct) -> None:
    match value:
        # This should generate an error because one union member overlaps unsafely.
        case ReturnsInt():
            assert_type(value, Correct)


class Wrapper:
    inner: Wrong


def test_nested(value: Wrapper) -> None:
    match value:
        # This should generate an error for the nested protocol pattern.
        case Wrapper(inner=ReturnsInt()):
            pass


@runtime_checkable
class HasInt(Protocol):
    value: int


class WrongData:
    value: str


def test_data(value: WrongData) -> None:
    match value:
        # This should generate an error because the data protocol overlaps unsafely.
        case HasInt():
            pass


T = TypeVar("T", bound=Wrong)


def test_type_var(value: T) -> T:
    match value:
        # This should generate an error for the type variable's bound.
        case ReturnsInt():
            return value
    return value


class Open:
    label: str


def test_safe_missing_member(value: Open) -> None:
    match value:
        case ReturnsInt():
            assert_type(value.label, str)
            assert_type(value.method(), int)
        case _:
            assert_type(value, Open)
