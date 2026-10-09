# This sample tests dictionary expansion for TypedDicts without an expected
# TypedDict target type context, as well as unpacking into typed targets.

from typing import NotRequired, TypedDict, reveal_type


class HomogeneousTD(TypedDict, extra_items=int):
    a: int
    b: int


class HeterogeneousTD(TypedDict):
    a: int
    b: str


class OptionalTD(TypedDict):
    a: int
    b: NotRequired[float]


class ClosedTD(TypedDict, closed=True):
    a: int


class TargetTD(TypedDict):
    a: int


class ExtraItemsTD(TypedDict, extra_items=str):
    a: int


class TargetExtraTD(TypedDict, extra_items=str):
    a: int


def test_homogeneous(td: HomogeneousTD):
    res1 = {**td}
    reveal_type(res1, expected_text="dict[str, int]")


def test_heterogeneous_default_mode(td: HeterogeneousTD):
    # In default mode (without strictDictionaryInference), heterogeneous value types
    # fall back to Unknown.
    res2 = {**td}
    reveal_type(res2, expected_text="dict[str, Unknown]")


def test_optional_default_mode(td: OptionalTD):
    res3 = {**td}
    reveal_type(res3, expected_text="dict[str, Unknown]")


def test_unpack_closed_into_target(td: ClosedTD):
    # Unpacking a closed TypedDict into a typed target should not produce assignment errors.
    target: TargetTD = {**td}


def test_unpack_extra_items_into_target(td: ExtraItemsTD):
    target: TargetExtraTD = {**td}


def test_unpack_extra_items_into_dict(td: ExtraItemsTD):
    res5 = {**td}
    # Unpacking extra_items=str TypedDict into dict display under strictDictionaryInference (or combineTypes)
    # includes extraItems valueType str. In default mode, int | str falls back to Unknown.
    reveal_type(res5, expected_text="dict[str, Unknown]")


class OpenTD(TypedDict):
    a: int


class HiddenTD(OpenTD):
    hidden: bytes


class ClosedOptionalTD(TypedDict, closed=True):
    a: int
    b: NotRequired[str]


def test_open_copy(td: OpenTD):
    # An open TypedDict can contain additional values of any type.
    res6 = {**td}
    reveal_type(res6, expected_text="dict[str, Unknown]")

    # This should generate an error because extra values need not be int.
    target: dict[str, int] = {**td}
    object_target: dict[str, object] = {**td}


def test_hidden_subtype(td: HiddenTD):
    test_open_copy(td)


def test_closed_optional_default(td: ClosedOptionalTD):
    res7 = {**td}
    reveal_type(res7, expected_text="dict[str, Unknown]")
