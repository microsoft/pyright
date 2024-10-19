# This sample tests the synthesis of "clear" and "popitem" within a closed
# TypedDict under certain circumstances.

from typing import NotRequired, Required, TypedDict
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


class TD1(TypedDict, total=False, extra_items=int):
    a: int


td1: TD1 = {"a": 1}

reveal_type(td1.clear, expected_text="() -> None")
reveal_type(td1.popitem, expected_text="() -> tuple[str, int]")
td1.clear()
td1.popitem()


class TD2(TypedDict, total=False, closed=True):
    a: str


td2: TD2 = {"a": "1"}

reveal_type(td2.clear, expected_text="() -> None")
reveal_type(td2.popitem, expected_text="() -> tuple[str, str]")
td2.clear()
td2.popitem()


class TD3(TypedDict, total=False, extra_items=ReadOnly[int]):
    a: int


td3: TD3 = {"a": 1}

# This should generate an error because extra_items is ReadOnly.
td3.clear()

# This should generate an error because extra_items is ReadOnly.
td3.popitem()


class TD4(TypedDict, closed=True):
    a: NotRequired[int]
    b: Required[int]


td4: TD4 = {"b": 1}

# This should generate an error because not all elements are NotRequired.
td4.clear()

# This should generate an error because not all elements are NotRequired.
td4.popitem()


class TD5(TypedDict, closed=True):
    a: NotRequired[ReadOnly[int]]


td5: TD5 = {"a": 1}

# This should generate an error because some elements are ReadOnly.
td5.clear()

# This should generate an error because some elements are ReadOnly.
td5.popitem()
