# This sample tests preservation of instance types in type(x) identity guards.

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Generic, Literal, Protocol, TypeVar, assert_never, assert_type, final
from uuid import UUID


class HasName(Protocol):
    def name(self) -> str: ...


@final
class Named:
    def name(self) -> str:
        return "named"


@final
class Unnamed:
    pass


def structural(value: Named, expected: type[HasName]):
    if expected is type(value):
        assert_type(value, Named)
    else:
        assert_type(value, Named)

    if type(value) is expected:
        assert_type(value, Named)


def structural_reference(value: HasName):
    if Named is type(value):
        assert_type(value, Named)

    if type(value) is Named:
        assert_type(value, Named)


def incompatible_protocol(value: Unnamed, expected: type[HasName]):
    if expected is type(value):
        reveal_type(value, expected_text="Never")


def numeric(value: int, expected: type[float]):
    if expected is type(value):
        assert_type(value, int)
    else:
        assert_type(value, int)

    if type(value) is expected:
        assert_type(value, int)

    if float is type(value):
        reveal_type(value, expected_text="Never")


def numeric_reference(value: float):
    if int is type(value):
        assert_type(value, int)


def literals(value: Literal[1, "a"]):
    if int is type(value):
        assert_type(value, Literal[1])
    else:
        assert_type(value, Literal["a"])

    if type(value) is int:
        assert_type(value, Literal[1])

    if str is not type(value):
        assert_type(value, Literal[1])
    else:
        assert_type(value, Literal["a"])


def literal_runtime_class(value: Literal[1]):
    if bool is type(value):
        assert_never(value)

    if type(value) is bool:
        assert_never(value)

    if int is not type(value):
        assert_never(value)
    else:
        assert_type(value, Literal[1])

    if type(value) is not int:
        assert_never(value)

    if int != type(value):
        assert_never(value)

    if type(value) != int:
        assert_never(value)


class StringChild(str):
    pass


def literal_subclass(value: Literal["x"], expected: type[StringChild]):
    if expected is type(value):
        assert_never(value)


class Base[T]:
    def __init__(self, value: T):
        self.value = value


class Sub[T](Base[T]):
    pass


def specialized(value: Base[int], expected: type[Sub[str]]):
    if expected is type(value):
        assert_type(value, Sub[int])
        assert_type(value.value, int)

    if type(value) is expected:
        assert_type(value, Sub[int])
        assert_type(value.value, int)


def invalid_specialization(value: Base[int], expected: type[Sub[str]]) -> str:
    if expected is type(value):
        # This should generate an error because class identity cannot change int to str.
        return value.value
    return ""


class Holder:
    value: int | str


def reverse_references(holder: Holder, values: list[int | str], other: int):
    if type(other) is type(holder.value):
        assert_type(holder.value, int)
    else:
        assert_type(holder.value, int | str)

    if type(other) is type(values[0]):
        assert_type(values[0], int)
    else:
        assert_type(values[0], int | str)

    if type(other) is not type(holder.value):
        assert_type(holder.value, int | str)
    else:
        assert_type(holder.value, int)


T = TypeVar("T", bool, bytes, int, Decimal, str, float, date, datetime, UUID)


class Validator(Generic[T]):
    def __init__(
        self,
        match: T,
        preprocessors: list[Callable[[T], T]] | None,
        predicate: Callable[[T], bool],
    ):
        self.match = match
        self.preprocessors = preprocessors
        self.predicate = predicate

    def identity(self, value: Any) -> T:
        if (match_type := type(self.match)) is type(value):
            assert_type(value, T)
            if self.preprocessors:
                for preprocess in self.preprocessors:
                    value = preprocess(value)
            # Loop joins retain the gradual input, as in concrete_loop below.
            assert_type(value, T | Any)
            if self.predicate(value):
                return value
        raise ValueError

    def equality(self, value: Any) -> T:
        if (match_type := type(self.match)) == type(value):
            # Equality of subclass-inclusive class objects does not establish identity.
            assert_type(value, Any)
            if self.preprocessors:
                for preprocess in self.preprocessors:
                    value = preprocess(value)
            assert_type(value, Any)
            if self.predicate(value):
                return value
        raise ValueError


def concrete_loop(value: Any, processors: list[Callable[[int], int]]) -> int:
    if isinstance(value, int):
        assert_type(value, int)
        for processor in processors:
            value = processor(value)
        assert_type(value, int | Any)
        return value
    raise TypeError


def from_any[U](value: Any, expected: type[U]) -> U:
    if expected is type(value):
        assert_type(value, U)
        return value
    raise TypeError


def from_unknown(expected: type[int], value):
    if expected is type(value):
        assert_type(value, int)


class Index:
    pass


class MultiIndex(Index):
    pass


def spark_continuation(value: MultiIndex, other: Index):
    if type(value) is not type(other):
        raise TypeError
    assert_type(value, MultiIndex)


structural(Named(), Named)
numeric(1, int)
specialized(Sub[int](42), Sub)
