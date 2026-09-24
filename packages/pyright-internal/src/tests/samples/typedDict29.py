# This sample tests dictionary expansion for TypedDicts when strictDictionaryInference is enabled.

from typing import NotRequired, TypedDict, reveal_type


class HomogeneousTD(TypedDict):
    a: int
    b: int


class HeterogeneousTD(TypedDict):
    a: int
    b: str


class OptionalTD(TypedDict):
    a: int
    b: NotRequired[float]


class ExtraItemsTD(TypedDict, extra_items=str):
    a: int


def test_heterogeneous_strict(td: HeterogeneousTD):
    res1 = {**td}
    reveal_type(res1, expected_text="dict[str, int | str]")


def test_optional_strict(td: OptionalTD):
    res2 = {**td}
    reveal_type(res2, expected_text="dict[str, int | float]")


def test_multiple_strict(td1: HomogeneousTD, td2: HeterogeneousTD, td3: OptionalTD):
    res3 = {**td1, **td2, **td3}
    reveal_type(res3, expected_text="dict[str, int | str | float]")


def test_extra_items_strict(td: ExtraItemsTD):
    res4 = {**td}
    reveal_type(res4, expected_text="dict[str, int | str]")


class EmptyTD(TypedDict):
    pass


class ClosedOptionalTD(TypedDict, closed=True):
    x: NotRequired[str]


def test_empty_strict(td: EmptyTD):
    res5 = {**td}
    reveal_type(res5, expected_text="dict[str, object]")
    for key in {**td}:
        reveal_type(key, expected_text="str")


def test_closed_optional_strict(a: ClosedOptionalTD, b: ClosedOptionalTD):
    # "x" may be present in "a" or "b", so its value type is included.
    res6 = {**a, **b, "x": 1}
    reveal_type(res6, expected_text="dict[str, str | int]")
