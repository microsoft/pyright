# This sample tests overload materialization using patterns found in
# real-world libraries and applications.

import re
from collections.abc import Callable, Sequence
from typing import Any, Generic, Literal, Never, ParamSpec, Protocol, TypeVar, overload
from typing_extensions import deprecated  # pyright: ignore[reportMissingModuleSource]

_T = TypeVar("_T")
_P = ParamSpec("_P")
_R = TypeVar("_R")


class Series(Generic[_T]):
    def item(self) -> _T:
        raise NotImplementedError

    @overload
    def __add__(self: "Series[int]", other: "int | Series[int]") -> "Series[int]": ...

    @overload
    def __add__(self: "Series[str]", other: "int | Series[str]") -> "Series[str]": ...

    def __add__(self, other: Any) -> "Series[Any]":
        return Series[Any]()


class Index(Generic[_T]):
    @overload
    def __mul__(self: "Index[int]", other: int) -> "Index[int]": ...

    @overload
    def __mul__(self: "Index[str]", other: int) -> "Index[str]": ...

    def __mul__(self, other: Any) -> "Index[Any]":
        return Index[Any]()


def check_pandas_operators(
    series_any: Series[Any],
    series_unknown: Series,
    series_int: Series[int],
    index_any: Index[Any],
    index_unknown: Index,
    index_str: Index[str],
) -> None:
    reveal_type(series_any + 1, expected_text="Any")
    reveal_type(series_unknown + 1, expected_text="Unknown")
    reveal_type(index_any * 2, expected_text="Any")
    reveal_type(index_unknown * 2, expected_text="Unknown")

    concrete_series = series_int + 1
    reveal_type(concrete_series, expected_text="Series[int]")
    reveal_type(concrete_series.item(), expected_text="int")
    reveal_type(index_str * 2, expected_text="Index[str]")

    # This should generate an error.
    _ = series_int + "bad"


class Flow(Generic[_P, _R]):
    @overload
    def __call__(self: "Flow[_P, Never]", *args: _P.args, **kwargs: _P.kwargs) -> None: ...

    @overload
    def __call__(self: "Flow[_P, _R]", *args: _P.args, **kwargs: _P.kwargs) -> _R: ...

    def __call__(self, *args: _P.args, **kwargs: _P.kwargs) -> Any:
        return None


def check_flow(flow_any: Flow[[], Any], flow_unknown: Flow, flow_int: Flow[[], int]) -> None:
    reveal_type(flow_any(), expected_text="Any")
    reveal_type(flow_unknown(), expected_text="Unknown")
    reveal_type(flow_int(), expected_text="int")
    reveal_type(flow_int() + 1, expected_text="int")

    # This should generate an error.
    flow_int(1)


class EnumMapper(Generic[_T, _R]):
    @overload
    def from_wire(self, value: _T) -> _R: ...

    @overload
    def from_wire(self, value: _T | None) -> _R | None: ...

    def from_wire(self, value: _T | None) -> _R | None:
        return None


def check_optional_mapper(
    mapper_any: EnumMapper[Any, str],
    mapper_unknown: EnumMapper,
    mapper_int: EnumMapper[int, str],
    value: Any,
) -> None:
    reveal_type(mapper_any.from_wire(value), expected_text="str")
    reveal_type(mapper_unknown.from_wire(value), expected_text="Unknown")
    reveal_type(mapper_int.from_wire(1), expected_text="str")
    reveal_type(mapper_int.from_wire(1).upper(), expected_text="str")


_Shape = TypeVar("_Shape")


class Rotation(Generic[_Shape]):
    @overload
    @classmethod
    def concatenate(
        cls, values: list["Rotation[tuple[()]]"]
    ) -> "Rotation[tuple[int]]": ...

    @overload
    @classmethod
    def concatenate(
        cls, values: list["Rotation[tuple[int]]"]
    ) -> "Rotation[tuple[int, int]]": ...

    @classmethod
    def concatenate(cls, values: list["Rotation[Any]"]) -> "Rotation[Any]":
        return Rotation[Any]()


def check_shape_overloads(
    rotations_any: list[Rotation[tuple[Any, ...]]],
    rotations_unknown: list[Rotation],
    rotations_scalar: list[Rotation[tuple[()]]],
) -> None:
    reveal_type(Rotation.concatenate(rotations_any), expected_text="Any")
    reveal_type(Rotation.concatenate(rotations_unknown), expected_text="Unknown")
    reveal_type(Rotation.concatenate(rotations_scalar), expected_text="Rotation[tuple[int]]")


def check_pattern(
    pattern: re.Pattern,
    pattern_any: re.Pattern[Any],
    pattern_str: re.Pattern[str],
    text: str,
) -> None:
    reveal_type(pattern.match(text), expected_text="Unknown")
    reveal_type(pattern.sub("", text), expected_text="Unknown")
    reveal_type(pattern_any.match(text), expected_text="Any")
    reveal_type(pattern_any.sub("", text), expected_text="Any")
    reveal_type(pattern_str.match(text), expected_text="Match[str] | None")
    reveal_type(pattern_str.sub("", text), expected_text="str")


class Table(Generic[_T]):
    @overload
    def __init__(self: "Table[int]", values: list[int]) -> None: ...

    @overload
    def __init__(self: "Table[str]", values: list[str]) -> None: ...

    @overload
    def __init__(self: "Table[bytes]", values: bytes) -> None: ...

    def __init__(self, values: list[Any] | bytes) -> None:
        pass


class AmbiguousTable(Generic[_T]):
    @overload
    def __init__(self: "AmbiguousTable[int]", values: list[int]) -> None: ...

    @overload
    def __init__(self: "AmbiguousTable[str]", values: list[str]) -> None: ...

    @overload
    def __init__(self: "AmbiguousTable[int]", values: set[int]) -> None: ...

    @overload
    def __init__(self: "AmbiguousTable[str]", values: set[str]) -> None: ...

    def __init__(self, values: list[Any] | set[Any]) -> None:
        pass


def check_constructors(values_any: list[Any], values_unknown: list, values_int: list[int]) -> None:
    reveal_type(Table(values_any), expected_text="Any")
    reveal_type(Table(values_unknown), expected_text="Unknown")
    reveal_type(Table(values_int), expected_text="Table[int]")
    reveal_type(Table[int](values_any), expected_text="Table[int]")

    # This should generate an error.
    Table[int](["bad"])


def check_constructor_union(
    table: Table[Any],
    values_any: list[Any] | bytes,
    values_unknown: list | bytes,
    values_int: list[int] | bytes,
    values_gradual: list[Any] | set,
) -> None:
    reveal_type(Table(values_any), expected_text="Any | Table[bytes]")
    reveal_type(Table(values_unknown), expected_text="Unknown | Table[bytes]")
    reveal_type(Table(values_int), expected_text="Table[int] | Table[bytes]")
    reveal_type(AmbiguousTable(values_gradual), expected_text="Any | Unknown")
    reveal_type(table.__init__(values_any), expected_text="None")


@overload
def covariant_case(values: Sequence[int]) -> int: ...


@overload
def covariant_case(values: Sequence[object]) -> object: ...


def covariant_case(values: Sequence[object]) -> object:
    return 0


def check_covariant(values: Sequence[Any], string_values: Sequence[str]) -> None:
    reveal_type(covariant_case(values), expected_text="int")
    reveal_type(covariant_case(values) + 1, expected_text="int")
    reveal_type(covariant_case(string_values), expected_text="object")


@overload
def top_level_case(value: int) -> int: ...


@overload
def top_level_case(value: str) -> str: ...


def top_level_case(value: Any) -> int | str:
    return value


def check_top_level(value_any: Any, value_unknown) -> None:
    reveal_type(top_level_case(value_any), expected_text="Unknown")
    reveal_type(top_level_case(value_unknown), expected_text="Unknown")


@overload
def equal_return_case(value: list[int]) -> int: ...


@overload
def equal_return_case(value: list[str]) -> int: ...


def equal_return_case(value: list[Any]) -> int:
    return 0


def check_equal_return(values: list[Any]) -> None:
    reveal_type(equal_return_case(values), expected_text="int")
    reveal_type(equal_return_case(values).bit_length(), expected_text="int")


@overload
def literal_case(value: list[int], kind: Literal["int"]) -> int: ...


@overload
def literal_case(value: list[str], kind: Literal["str"]) -> str: ...


def literal_case(value: list[Any], kind: str) -> int | str:
    return 0


def check_literal(values: list[Any]) -> None:
    reveal_type(literal_case(values, "int"), expected_text="int")
    reveal_type(literal_case(values, "str"), expected_text="str")

    # This should generate an error.
    literal_case(values, "bad")


_default_values: list[Any] = []


@overload
def default_case(tag: Literal[1], values: list[int] = _default_values) -> Literal[1]: ...


@overload
def default_case(tag: int) -> int: ...


def default_case(tag: int, values: Any = _default_values) -> int:
    return tag


@overload
def contextual_case(value: list[Any], flag: Literal[True]) -> str: ...


@overload
def contextual_case(value: list[int], flag: bool) -> object: ...


def contextual_case(value: list[Any], flag: bool) -> object:
    return value


def check_defaults_and_context() -> None:
    reveal_type(default_case(1), expected_text="Literal[1]")
    reveal_type(contextual_case([], True), expected_text="str")


@overload
def keyword_default_case(value: list[int], *, scale: int = 0, name: str) -> int: ...


@overload
def keyword_default_case(value: list[str], *, name: str, scale: int = 0) -> str: ...


def keyword_default_case(value: list[Any], *, name: str, scale: int = 0) -> int | str:
    return scale


def check_keyword_default(values_any: list[Any], values_unknown: list) -> None:
    reveal_type(keyword_default_case(name="value", value=values_any), expected_text="Any")
    reveal_type(keyword_default_case(name="value", value=values_unknown), expected_text="Unknown")
    reveal_type(keyword_default_case(name="value", value=values_any, scale=1), expected_text="Any")


_TBound = TypeVar("_TBound", bound=int)
_TConstrained = TypeVar("_TConstrained", int, str)


@overload
def generic_second(value: list[int]) -> int: ...


@overload
def generic_second(value: list[_T]) -> _T: ...


def generic_second(value: list[Any]) -> Any:
    return value[0]


@overload
def bounded_first(value: list[_TBound]) -> _TBound: ...


@overload
def bounded_first(value: list[str]) -> str: ...


def bounded_first(value: list[Any]) -> Any:
    return value[0]


@overload
def constrained_first(value: list[_TConstrained]) -> _TConstrained: ...


@overload
def constrained_first(value: list[bytes]) -> bytes: ...


def constrained_first(value: list[Any]) -> Any:
    return value[0]


def check_typevars(values_any: list[Any], values_unknown: list) -> None:
    reveal_type(generic_second(values_any), expected_text="int")
    reveal_type(generic_second(values_unknown), expected_text="int")
    reveal_type(bounded_first(values_any), expected_text="Any")
    reveal_type(bounded_first(values_unknown), expected_text="Unknown")
    reveal_type(constrained_first(values_any), expected_text="Any")
    reveal_type(constrained_first(values_unknown), expected_text="Unknown")


@overload
def multi_argument_case(value: list[int], fallback: int) -> int: ...


@overload
def multi_argument_case(value: list[str], fallback: str) -> int: ...


@overload
def multi_argument_case(value: int, fallback: int) -> list[int]: ...


def multi_argument_case(value: list[int] | list[str] | int, fallback: int | str) -> int | list[int]:
    return 0


def check_multiple_arguments(values_any: list[Any], value_any: Any) -> None:
    result = multi_argument_case(values_any, value_any)
    reveal_type(result, expected_text="int")
    reveal_type(result.bit_length(), expected_text="int")
    reveal_type(multi_argument_case(value_any, 1), expected_text="Unknown")


class Reader(Protocol):
    def read(self) -> str: ...


@overload
def protocol_case(value: list[Reader]) -> int: ...


@overload
def protocol_case(value: list[str]) -> str: ...


def protocol_case(value: list[Any]) -> int | str:
    return 0


@overload
def callable_case(value: list[Callable[[int], int]]) -> int: ...


@overload
def callable_case(value: list[str]) -> str: ...


def callable_case(value: list[Any]) -> int | str:
    return 0


@overload
def union_case(value: list[int | str]) -> int: ...


@overload
def union_case(value: list[bytes | float]) -> str: ...


def union_case(value: list[Any]) -> int | str:
    return 0


@overload
def tuple_case(value: list[tuple[int, int]]) -> int: ...


@overload
def tuple_case(value: list[tuple[str, str]]) -> str: ...


def tuple_case(value: list[tuple[Any, Any]]) -> int | str:
    return 0


@overload
def tuple_union_case(value: list[tuple[int | str]]) -> int: ...


@overload
def tuple_union_case(value: list[tuple[bytes | float]]) -> str: ...


def tuple_union_case(value: list[tuple[Any]]) -> int | str:
    return 0


def check_supported_and_unsupported_shapes(
    values_any: list[Any],
    values_unknown: list,
    tuple_values: list[tuple[Any, Any]],
    tuple_unknown_values: list[tuple],
    tuple_union_values: list[tuple[Any]],
) -> None:
    reveal_type(protocol_case(values_any), expected_text="int")
    reveal_type(protocol_case(values_unknown), expected_text="int")
    reveal_type(callable_case(values_any), expected_text="int")
    reveal_type(callable_case(values_unknown), expected_text="int")
    reveal_type(union_case(values_any), expected_text="int")
    reveal_type(union_case(values_unknown), expected_text="int")
    reveal_type(tuple_case(tuple_values), expected_text="Any")
    reveal_type(tuple_case(tuple_unknown_values), expected_text="Unknown")
    reveal_type(tuple_union_case(tuple_union_values), expected_text="int")


_TContra = TypeVar("_TContra", contravariant=True)


class Sink(Generic[_TContra]):
    pass


@overload
def contravariant_case(value: Sink[int]) -> int: ...


@overload
def contravariant_case(value: Sink[str]) -> str: ...


def contravariant_case(value: Sink[Any]) -> int | str:
    return 0


def check_contravariant(value: Sink[Any], value_unknown: Sink) -> None:
    reveal_type(contravariant_case(value), expected_text="int")
    reveal_type(contravariant_case(value_unknown), expected_text="int")


@overload
@deprecated("integer values are deprecated")
def deprecated_case(value: list[int]) -> int: ...


@overload
def deprecated_case(value: list[str]) -> str: ...


def deprecated_case(value: list[Any]) -> int | str:
    return 0


def check_deprecated(values: list[Any], string_values: list[str]) -> None:
    # This should generate a deprecation warning.
    reveal_type(deprecated_case(values), expected_text="Any")
    reveal_type(deprecated_case(string_values), expected_text="str")
