# Dictionary unpacking in comprehensions preserves the mapping's key and value types.

from typing import Literal, Mapping, TypedDict


class Open(TypedDict):
    a: int
    b: str


class Closed(TypedDict, closed=True):
    a: int
    b: str


def unpack_open(items: list[Open]) -> None:
    reveal_type({**item for item in items}, expected_text="dict[str, int | str | object]")


def unpack_closed(items: list[Closed]) -> None:
    result = {**item for item in items}
    reveal_type(result, expected_text="dict[str, int | str]")
    value: int | str = result["a"]
    result["bad"] = None  # This should generate an error.


def unpack_union(items: list[Closed | Mapping[str, bytes]]) -> None:
    reveal_type({**item for item in items}, expected_text="dict[str, int | str | bytes]")


def use_mapping(items: list[Mapping[str, int]]) -> None:
    reveal_type({**item for item in items}, expected_text="dict[str, int]")
    result: dict[Literal["a"], Literal[1]] = {**item for item in [{"a": 1}]}
    reveal_type(result, expected_text="dict[Literal['a'], Literal[1]]")


def invalid_operand(items: list[int]) -> None:
    {**item for item in items}  # This should generate an error.
