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
