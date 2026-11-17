# This sample preserves non-bool and generic results across cheap comparison
# shortcuts, and precise tuple indexing without generic method specialization.

from typing import Literal, SupportsIndex, assert_type, overload


def bool_only(value: bool) -> None:
    pass


def str_only(value: str) -> None:
    pass


def bytes_only(value: bytes) -> None:
    pass


def str_or_bool(value: str | bool) -> None:
    pass


class Value:
    def __lt__(self, other: object) -> str:
        return "ordered"

    def __le__(self, other: object) -> str:
        return "ordered"

    def __gt__(self, other: object) -> str:
        return "ordered"

    def __ge__(self, other: object) -> str:
        return "ordered"


type Values = tuple[
    *tuple[Value, ...],
    Value, Value, Value, Value, Value, Value, Value, Value,
    Value, Value, Value, Value, Value, Value, Value, Value,
    Value, Value, Value, Value, Value, Value, Value, Value,
    Value, Value, Value, Value, Value, Value, Value, Value,
]


def homogeneous(left: Values, right: Values) -> None:
    assert_type(left < right, str | bool)
    assert_type(left <= right, str | bool)
    assert_type(left > right, str | bool)
    assert_type(left >= right, str | bool)
    str_or_bool(left < right)
    str_or_bool(left <= right)
    str_or_bool(left > right)
    str_or_bool(left >= right)

    bool_only(left < right)  # negative-bool-lt
    bool_only(left <= right)  # negative-bool-le
    bool_only(left > right)  # negative-bool-gt
    bool_only(left >= right)  # negative-bool-ge
    str_only(left < right)  # negative-str-lt
    str_only(left <= right)  # negative-str-le
    str_only(left > right)  # negative-str-gt
    str_only(left >= right)  # negative-str-ge


class BytesValue:
    def __lt__(self, other: object) -> bytes:
        return b"ordered"

    def __le__(self, other: object) -> bytes:
        return b"ordered"

    def __gt__(self, other: object) -> bytes:
        return b"ordered"

    def __ge__(self, other: object) -> bytes:
        return b"ordered"


type Mixed = tuple[*tuple[Value, ...], BytesValue]


def heterogeneous(left: Mixed, right: Mixed) -> None:
    assert_type(left < right, str | bytes | bool)
    assert_type(left <= right, str | bytes | bool)
    assert_type(left > right, str | bytes | bool)
    assert_type(left >= right, str | bytes | bool)
    bool_only(left < right)  # negative-mixed-bool
    bytes_only(left < right)  # negative-mixed-bytes


class Box[T]:
    def __init__(self, value: T) -> None:
        self.value = value

    def __lt__(self, other: object) -> T:
        return self.value

    def __le__(self, other: object) -> T:
        return self.value

    def __gt__(self, other: object) -> T:
        return self.value

    def __ge__(self, other: object) -> T:
        return self.value


type GenericValues[T] = tuple[*tuple[Box[T], ...], Box[T], Box[T]]


def generic[T](left: GenericValues[T], right: GenericValues[T]) -> None:
    assert_type(left < right, T | bool)
    assert_type(left <= right, T | bool)
    assert_type(left > right, T | bool)
    assert_type(left >= right, T | bool)


def scalar_product(index: int) -> None:
    choices = ((0, 1, 2, 3, 4, 5, 6, 7),)[0]
    left = choices[index]
    right = choices[index]
    assert_type(left, Literal[0, 1, 2, 3, 4, 5, 6, 7])
    assert_type(right, Literal[0, 1, 2, 3, 4, 5, 6, 7])
    assert_type(left < right, bool)
    assert_type(left <= right, bool)
    assert_type(left > right, bool)
    assert_type(left >= right, bool)
    bool_only(left < right)
    bool_only(left <= right)
    bool_only(left > right)
    bool_only(left >= right)


class LiteralSensitive:
    @overload
    def __lt__(self, other: Literal[0]) -> str: ...

    @overload
    def __lt__(self, other: int) -> str | bytes: ...

    def __lt__(self, other: int) -> str | bytes:
        return "zero" if other == 0 else b"nonzero"


def custom_scalar(left: LiteralSensitive) -> None:
    value = ((0,),)[0][0]
    assert_type(left < value, str)
    str_only(left < value)
    bytes_only(left < value)  # negative-custom-bytes


def declared_scalar(left: Literal[1], right: Literal[2]) -> None:
    assert_type(left + right, Literal[3])
    assert_type(left < right, bool)


class CustomIndex(tuple[int, ...]):
    @overload
    def __getitem__(self, index: SupportsIndex, /) -> Literal[7]: ...

    @overload
    def __getitem__(self, index: slice, /) -> tuple[int, ...]: ...

    def __getitem__(self, index: SupportsIndex | slice, /) -> Literal[7] | tuple[int, ...]:
        return (7,) if isinstance(index, slice) else 7


def indexing(value: tuple[int, str], custom: CustomIndex, index: int) -> None:
    assert_type(value[0], int)
    assert_type(value[-1], str)
    assert_type(value[1:], tuple[str])
    assert_type(value[index], int | str)
    assert_type(custom[0], Literal[7])
    assert_type(custom[index], Literal[7])
    assert_type(custom[:], tuple[int, ...])
    value[0] = 1  # negative-index-write
    del value[0]  # negative-index-delete
