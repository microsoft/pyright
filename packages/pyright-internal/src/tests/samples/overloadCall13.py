# This sample records known limitations restored by rolling back #11601/#11732.
# Ambiguous results should permit assignments and operations supported by either
# retained materialization. The expected first-match types below do not meet that requirement.

from typing import Any, Generic, Never, TypeAlias, TypeVar, assert_type, overload

_T = TypeVar("_T")


class Container(Generic[_T]):
    @overload
    def copy(self: "Container[Never]") -> "Container[Any]": ...
    @overload
    def copy(self: "Container[int]") -> "Container[int]": ...
    @overload
    def copy(self: "Container[float]") -> "Container[float]": ...
    def copy(self) -> "Container[Any]":
        return self

    def item(self) -> _T:
        raise NotImplementedError


def check_copy(value: Container[Any], unknown: Container, concrete: Container[int]) -> None:
    result = value.copy()
    assert_type(result, Container[Any])
    assert_type(result.item(), Any)
    int_result: Container[int] = result
    float_result: Container[float] = result

    # Known rollback limitation: the first Never-specialized self erases Unknown to Any.
    unknown_result = unknown.copy()
    reveal_type(unknown_result, expected_text="Container[Any]")
    reveal_type(unknown_result.item(), expected_text="Any")
    assert_type(concrete.copy(), Container[int])
    assert_type(concrete.copy().item(), int)

    # Each of these should generate an error for the nonexistent attribute.
    result.nonexistent_member()
    unknown_result.nonexistent_member()
    concrete.copy().nonexistent_member()


IntResult: TypeAlias = dict[str, list[int]]
StrResult: TypeAlias = dict[str, list[str]]


@overload
def nested(value: list[int]) -> IntResult: ...
@overload
def nested(value: list[str]) -> StrResult: ...
def nested(value: Any) -> dict[str, list[Any]]:
    return {}


def check_nested(value: list[Any], unknown: list) -> None:
    result = nested(value)
    # Known rollback limitation: only the int materialization survives.
    assert_type(result, dict[str, list[int]])
    int_result: IntResult = result
    # This should generate an error despite str being a retained materialization.
    str_result: StrResult = result
    result["key"].append(1)
    # This should generate an error: the rollback rejects a supported mutation.
    result["key"].append("value")
    assert_type(result["key"][0], int)
    reveal_type(nested(unknown), expected_text="dict[str, list[int]]")

    # This should generate an error for the nonexistent attribute.
    result["key"].nonexistent_member()


@overload
def tuple_result(value: list[int]) -> tuple[str, list[int]]: ...
@overload
def tuple_result(value: list[str]) -> tuple[str, list[str]]: ...
def tuple_result(value: Any) -> tuple[str, list[Any]]:
    return ("", [])


def check_tuple(value: list[Any]) -> None:
    result = tuple_result(value)
    # Known rollback limitation: tuple structure remains, but its list loses str.
    assert_type(result, tuple[str, list[int]])
    int_result: tuple[str, list[int]] = result
    # This should generate an error despite str being a retained materialization.
    str_result: tuple[str, list[str]] = result
    result[0].upper()
    result[1].append(1)
    # This should generate an error: the rollback rejects a supported mutation.
    result[1].append("value")

    # This should generate an error for the nonexistent attribute.
    result[1].nonexistent_member()


@overload
def different_shapes(value: list[int]) -> tuple[int]: ...
@overload
def different_shapes(value: list[str]) -> tuple[str, str]: ...
def different_shapes(value: Any) -> Any:
    pass


@overload
def different_families(value: list[int]) -> list[int]: ...
@overload
def different_families(value: list[str]) -> set[str]: ...
def different_families(value: Any) -> Any:
    pass


@overload
def unconstrained_result(value: list[int]) -> list[int]: ...
@overload
def unconstrained_result(value: list[str]) -> Any: ...
def unconstrained_result(value: Any) -> Any:
    pass


@overload
def optional_result(value: list[int]) -> list[int] | None: ...
@overload
def optional_result(value: list[str]) -> list[str]: ...
def optional_result(value: Any) -> Any:
    pass


@overload
def never_result(value: list[int]) -> Never: ...
@overload
def never_result(value: list[str]) -> list[str]: ...
def never_result(value: Any) -> Any:
    pass


def check_fallbacks(value: list[Any], unknown: list) -> None:
    # Known rollback limitation: unsupported common shapes also select only the first result.
    assert_type(different_shapes(value), tuple[int])
    assert_type(different_families(value), list[int])
    assert_type(unconstrained_result(value), list[int])
    assert_type(optional_result(value), list[int] | None)
    reveal_type(different_shapes(unknown), expected_text="tuple[int]")
    reveal_type(different_families(unknown), expected_text="list[int]")
    reveal_type(unconstrained_result(unknown), expected_text="list[int]")
    reveal_type(optional_result(unknown), expected_text="list[int] | None")


# Keep Never calls in separate functions so neither hides the other Unknown,
# fallback, or operation controls as unreachable after the rollback.
def check_never_any(value: list[Any]) -> None:
    # Known rollback limitation: a possible list[str] result is incorrectly treated as Never.
    reveal_type(never_result(value), expected_text="Never")


def check_never_unknown(unknown: list) -> None:
    reveal_type(never_result(unknown), expected_text="Never")


class Constructed(Generic[_T]):
    @overload
    def __init__(self: "Constructed[int]", value: list[int]) -> None: ...
    @overload
    def __init__(self: "Constructed[str]", value: list[str]) -> None: ...
    def __init__(self, value: Any) -> None:
        pass

    def item(self) -> _T:
        raise NotImplementedError


def check_constructor(value: list[Any], unknown: list) -> None:
    result = Constructed(value)
    # Known rollback limitation: inferred construction drops the str alternative.
    assert_type(result, Constructed[int])
    assert_type(result.item(), int)
    reveal_type(Constructed(unknown), expected_text="Constructed[int]")
    assert_type(Constructed[int](value), Constructed[int])

    # This should generate an error for the nonexistent attribute.
    result.nonexistent_member()


_T_co = TypeVar("_T_co", covariant=True)


class Covariant(Generic[_T_co]):
    @overload
    def get(self: "Covariant[int]") -> int: ...
    @overload
    def get(self: "Covariant[str]") -> str: ...
    def get(self) -> Any:
        pass


@overload
def covariant_result(value: list[int]) -> Covariant[int]: ...
@overload
def covariant_result(value: list[str]) -> Covariant[str]: ...
def covariant_result(value: Any) -> Any:
    pass


def check_covariant(value: list[Any], unknown: list, concrete: Covariant[str]) -> None:
    # Known rollback limitation: first-match Covariant[int] rejects operations on Covariant[str].
    assert_type(covariant_result(value), Covariant[int])
    reveal_type(covariant_result(unknown), expected_text="Covariant[int]")
    # This should generate an error despite str.upper being supported by a materialization.
    covariant_result(value).get().upper()
    covariant_result(value).get().bit_length()
    # This should generate the same error for the independently checked Unknown path.
    covariant_result(unknown).get().upper()
    covariant_result(unknown).get().bit_length()
    assert_type(concrete.get(), str)
