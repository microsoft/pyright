# This sample tests dictionary expansion for TypedDicts without an expected
# TypedDict target type context.

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


def test_homogeneous(td: HomogeneousTD):
    res1 = {**td}
    reveal_type(res1, expected_text="dict[str, int]")


def test_heterogeneous(td: HeterogeneousTD):
    res2 = {**td}
    reveal_type(res2, expected_text="dict[str, int | str]")


def test_optional(td: OptionalTD):
    res3 = {**td}
    reveal_type(res3, expected_text="dict[str, int | float]")


def test_multiple(td1: HomogeneousTD, td2: HeterogeneousTD, td3: OptionalTD):
    res4 = {**td1, **td2, **td3}
    reveal_type(res4, expected_text="dict[str, int | str | float]")
