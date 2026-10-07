# This sample tests limits on protocol intersection narrowing in class patterns.

from typing import Protocol, final, runtime_checkable
from typing_extensions import assert_type  # pyright: ignore[reportMissingModuleSource]


class Foo:
    pass


@runtime_checkable
class SupportsMethod(Protocol):
    def method(self) -> None: ...


@final
class FinalFoo:
    pass


def test_final_subject(value: FinalFoo) -> None:
    match value:
        # This should generate an error because a final class cannot gain the method.
        case SupportsMethod():
            pass
        case _:
            assert_type(value, FinalFoo)


@runtime_checkable
class HasValue(Protocol):
    value: int


def test_impossible_argument(value: Foo) -> None:
    match value:
        # This should generate an error because the protocol's value cannot be a str.
        case HasValue(value=str()):
            pass
        case _:
            assert_type(value, Foo)


def test_impossible_literal(value: Foo) -> None:
    match value:
        # This should generate an error because the protocol's value cannot be None.
        case HasValue(value=None):
            pass
        case _:
            assert_type(value, Foo)


class NotRuntimeCheckable(Protocol):
    def method(self) -> None: ...


def test_invalid_protocol(value: Foo) -> None:
    match value:
        # This should generate an error because the protocol is not runtime checkable.
        case NotRuntimeCheckable():
            pass


class Bar:
    pass


def test_nominal_pattern(value: Foo) -> None:
    match value:
        # This should generate an error; nominal class-pattern behavior is unchanged.
        case Bar():
            pass
        case _:
            assert_type(value, Foo)


def test_unrelated_builtin(value: int) -> None:
    match value:
        # This should generate an error; unrelated builtin patterns remain impossible.
        case str():
            pass
        case _:
            assert_type(value, int)
