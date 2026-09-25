# This sample checks that replaying a union-expanded constructor call does not
# apply one mapping branch's type variable constraints to another branch.

from collections.abc import Iterable, Mapping, MutableMapping
from typing import Generic, TypeVar, assert_type, overload


class CacheControl(MutableMapping[str, str | None]):
    _data: MutableMapping[str, str | None]

    def __init__(
        self,
        values: Mapping[str, str | None] | Iterable[tuple[str, str | None]] | None = None,
    ) -> None:
        if values is None:
            values = {}
        elif isinstance(values, Mapping):
            if not isinstance(values, MutableMapping):
                values = dict(values)
        else:
            values = dict(values)

        # This should generate an error: the narrowed union still includes mappings
        # whose keys are pairs, which cannot be assigned to this string-keyed field.
        self._data = values


def concrete_mapping(values: Mapping[str, str | None]) -> None:
    result = dict(values)
    assert_type(result, dict[str, str | None])
    result["new"] = None
    result["other"] = "value"
    assert_type(result.get("missing"), str | None)

    # This should generate an error: the key must remain str.
    result[1] = None
    # This should generate an error: the value must remain str | None.
    result["bad"] = 1
    # This should generate an error: construction must not erase the dict type.
    result.nonexistent_member()


def iterable_pairs(values: Iterable[tuple[str, int]]) -> None:
    result = dict(values)
    assert_type(result, dict[str, int])
    assert_type(result["key"].bit_length(), int)


def optional_mapping(values: Mapping[str, int] | None = None) -> None:
    if values is None:
        values = {}
    result = dict(values)
    assert_type(result, dict[str, int])


def mapping_union(values: Mapping[str, int] | Mapping[int, str]) -> None:
    result = dict(values)
    assert_type(result, dict[str, int] | dict[int, str])
    for value in result.values():
        assert_type(value, int | str)

    contextual: Mapping[str, int] | Mapping[int, str] = dict(values)
    assert_type(contextual, dict[str, int] | dict[int, str])

    factory = dict
    assert_type(factory(values), dict[str, int] | dict[int, str])


def reversed_union(values: Mapping[int, str] | Mapping[str, int]) -> None:
    assert_type(dict(values), dict[int, str] | dict[str, int])


def different_overloads(values: Mapping[str, int] | Iterable[tuple[int, str]]) -> None:
    assert_type(dict(values), dict[str, int] | dict[int, str])


def explicit_specialization(values: Mapping[str, int] | Iterable[tuple[str, int]]) -> None:
    assert_type(dict[str, int](values), dict[str, int])


T = TypeVar("T")


class Box(Generic[T]):
    @overload
    def __init__(self, values: list[T]) -> None: ...
    @overload
    def __init__(self, values: set[T]) -> None: ...
    def __init__(self, values: list[T] | set[T]) -> None: ...

    def get(self) -> T: ...


class SpecializedBox(Generic[T]):
    @overload
    def __init__(self: "SpecializedBox[int]", values: list[int]) -> None: ...
    @overload
    def __init__(self: "SpecializedBox[str]", values: set[str]) -> None: ...
    def __init__(self, values: list[int] | set[str]) -> None: ...

    def get(self) -> T: ...


def overloaded_init(values: list[int] | set[str]) -> None:
    box = Box(values)
    assert_type(box, Box[int] | Box[str])
    assert_type(box.get(), int | str)
    contextual: Box[int] | Box[str] = Box(values)
    assert_type(contextual, Box[int] | Box[str])

    specialized = SpecializedBox(values)
    assert_type(specialized, SpecializedBox[int] | SpecializedBox[str])
    assert_type(specialized.get(), int | str)

    # This should generate two errors: an explicit int specialization rejects set[str].
    Box[int](values)
