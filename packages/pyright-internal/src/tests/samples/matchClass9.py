# This sample tests intersection narrowing for runtime-checkable protocol patterns.

from typing import Generic, Protocol, TypeVar, runtime_checkable
from typing_extensions import assert_type  # pyright: ignore[reportMissingModuleSource]


class Foo:
    label: str


@runtime_checkable
class SupportsMethod(Protocol):
    def method(self) -> int: ...


def test_protocol(value: Foo) -> None:
    match value:
        case SupportsMethod() as captured:
            reveal_type(value, expected_text="<subclass of Foo and SupportsMethod>")
            reveal_type(captured, expected_text="<subclass of Foo and SupportsMethod>")
            assert_type(value.label, str)
            assert_type(value.method(), int)
        case _:
            assert_type(value, Foo)

    if isinstance(value, SupportsMethod):
        reveal_type(value, expected_text="<subclass of Foo and SupportsMethod>")
    else:
        assert_type(value, Foo)


class ImplementsMethod(Foo):
    def method(self) -> int:
        return 1


def test_known_implementation(value: Foo | ImplementsMethod) -> None:
    match value:
        case SupportsMethod():
            assert_type(value, ImplementsMethod)
        case _:
            assert_type(value, Foo)


@runtime_checkable
class SupportsOtherMethod(Protocol):
    def other_method(self) -> str: ...


def test_nested_protocol(value: Foo) -> None:
    match value:
        case SupportsMethod():
            match value:
                case SupportsOtherMethod():
                    reveal_type(
                        value,
                        expected_text="<subclass of <subclass of Foo and SupportsMethod> and SupportsOtherMethod>",
                    )
                    assert_type(value.label, str)
                    assert_type(value.method(), int)
                    assert_type(value.other_method(), str)
                case _:
                    reveal_type(value, expected_text="<subclass of Foo and SupportsMethod>")
        case _:
            assert_type(value, Foo)


@runtime_checkable
class HasValue(Protocol):
    __match_args__ = ("value",)
    value: int


def test_keyword_pattern(value: Foo) -> None:
    match value:
        case HasValue(value=int() as item):
            reveal_type(value, expected_text="<subclass of Foo and HasValue>")
            assert_type(item, int)
            assert_type(value.label, str)
        case _:
            assert_type(value, Foo)


def test_positional_pattern(value: Foo) -> None:
    match value:
        case HasValue(item):
            reveal_type(value, expected_text="<subclass of Foo and HasValue>")
            assert_type(item, int)
        case _:
            assert_type(value, Foo)


def test_guard(value: Foo, condition: bool) -> None:
    match value:
        case SupportsMethod() if condition:
            reveal_type(value, expected_text="<subclass of Foo and SupportsMethod>")
        case _:
            assert_type(value, Foo)


T = TypeVar("T", bound=Foo)


def test_type_var(value: T) -> T:
    match value:
        case SupportsMethod():
            reveal_type(value, expected_text="<subclass of Foo* and SupportsMethod>*")
            assert_type(value.method(), int)
            return value
        case _:
            return value


def test_type_var_isinstance(value: T) -> T:
    if isinstance(value, SupportsMethod):
        reveal_type(value, expected_text="<subclass of Foo* and SupportsMethod>*")
        assert_type(value.method(), int)
        return value
    return value


class GenericFoo(Generic[T]):
    def get(self) -> T:
        raise NotImplementedError


def test_generic_subject(value: GenericFoo[Foo]) -> None:
    match value:
        case SupportsMethod():
            reveal_type(
                value,
                expected_text="<subclass of GenericFoo[Foo] and SupportsMethod>",
            )
            assert_type(value.get(), Foo)
            assert_type(value.method(), int)
        case _:
            assert_type(value, GenericFoo[Foo])


def test_builtin_subject(value: int) -> None:
    match value:
        case SupportsMethod():
            reveal_type(value, expected_text="<subclass of int and SupportsMethod>")
            assert_type(value.method(), int)
        case _:
            assert_type(value, int)
