# An ambiguous initializer must not infer a repeated alias variable from only
# its known occurrence and use that type for an unknown occurrence.

from typing import Any, Generic, TypeAlias, TypeVar, overload

T = TypeVar("T")
U = TypeVar("U")
V = TypeVar("V")


class Pair(Generic[T, U]):
    @overload
    def __init__(self: "Pair[str, int]", value: int) -> None: ...
    @overload
    def __init__(self: "Pair[str, float]", value: str) -> None: ...
    def __init__(self, value: Any) -> None: ...

    def second(self) -> U:
        raise NotImplementedError


Repeated: TypeAlias = Pair[V, V]
Chain: TypeAlias = Repeated[V]
Fixed: TypeAlias = Pair[str, V]


def check_any(value: Any) -> None:
    reveal_type(Repeated(value), expected_text="Pair[Unknown, Unknown]")
    reveal_type(Chain(value=value), expected_text="Pair[Unknown, Unknown]")
    reveal_type(Fixed(value), expected_text="Pair[str, Unknown]")
    _ = Repeated(value).second() + 1
    _ = Chain(value=value).second() + 1


class ReversePair(Generic[T, U]):
    @overload
    def __init__(self: "ReversePair[int, str]", value: int) -> None: ...
    @overload
    def __init__(self: "ReversePair[float, str]", value: str) -> None: ...
    def __init__(self, value: Any) -> None: ...

    def first(self) -> T:
        raise NotImplementedError


Reverse: TypeAlias = ReversePair[V, V]


def check_unknown(value) -> None:
    reveal_type(Reverse(value), expected_text="ReversePair[Unknown, Unknown]")
    _ = Reverse(value).first() + 1


class NestedPair(Generic[T, U]):
    @overload
    def __init__(self: "NestedPair[list[str], list[int]]", value: int) -> None: ...
    @overload
    def __init__(self: "NestedPair[list[str], list[float]]", value: str) -> None: ...
    def __init__(self, value: Any) -> None: ...

    def second(self) -> U:
        raise NotImplementedError


Nested: TypeAlias = NestedPair[list[V], list[V]]


def check_nested(value: Any) -> None:
    reveal_type(Nested(value), expected_text="NestedPair[list[Unknown], list[Unknown]]")
    _ = Nested(value).second()[0] + 1
