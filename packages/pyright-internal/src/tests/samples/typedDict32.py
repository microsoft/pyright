# This sample tests dictionary expansion for TypedDicts when strictDictionaryInference is enabled.

from typing import NotRequired, TypedDict, reveal_type


class HomogeneousTD(TypedDict, closed=True):
    a: int
    b: int


class HeterogeneousTD(TypedDict, closed=True):
    a: int
    b: str


class OptionalTD(TypedDict, closed=True):
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


class Counter(TypedDict):
    count: int


class HiddenCounter(Counter):
    hidden: bytes


class Payload(TypedDict):
    label: str
    data: bytes


class ExtraPayload(TypedDict, extra_items=int):
    label: str
    data: bytes


class ClosedPayload(TypedDict, closed=True):
    label: str
    data: bytes


def accepts_int(values: dict[str, int]) -> None:
    pass


def accepts_numbers_or_text(values: dict[str, int | str]) -> None:
    pass


def test_open_copy(td: Counter):
    res7 = {**td}
    reveal_type(res7, expected_text="dict[str, int | object]")

    # This should generate an error because hidden fields can contain other types.
    accepts_int(res7)

    # This should generate an error for the same reason in a typed context.
    target: dict[str, int] = {**td}
    object_target: dict[str, object] = {**td}


def test_hidden_subtype(td: HiddenCounter):
    test_open_copy(td)


def test_overwritten_open(td1: Counter, td2: Payload):
    res8 = {**td1, **td2, "label": 1}
    reveal_type(res8, expected_text="dict[str, int | object | bytes]")

    # This should generate an error because overwriting label does not remove data.
    accepts_numbers_or_text(res8)


def test_overwritten_entries(td: Counter):
    res9 = {**td, "replace": 0, "keep": b"retained", "replace": "new"}
    reveal_type(res9, expected_text="dict[str, int | object | bytes | str]")

    # This should generate an error because overwriting replace does not remove keep.
    accepts_numbers_or_text(res9)


def test_overwritten_extra_items(td1: Counter, td2: ExtraPayload):
    res10 = {**td1, **td2, "label": 1}
    reveal_type(res10, expected_text="dict[str, int | object | bytes]")

    # This should generate an error because the declared bytes field remains.
    accepts_numbers_or_text(res10)


def test_overwritten_closed(td1: HomogeneousTD, td2: ClosedPayload):
    res11 = {**td1, **td2, "label": 1}
    reveal_type(res11, expected_text="dict[str, int | bytes]")
    target: dict[str, int | bytes] = res11
