# This sample tests protocol compatibility for closed TypedDicts.

from collections.abc import Mapping
from typing import TYPE_CHECKING
from typing_extensions import TypedDict

if TYPE_CHECKING:
    from _typeshed import SupportsItems


class Closed(TypedDict, closed=True):
    a: str
    b: int


def func(c: Closed) -> None:
    reveal_type(c.items(), expected_text="dict_items[Literal['a', 'b'], str | int]")

    mapping: Mapping[str, str | int] = c
    items: SupportsItems[str, str | int] = c

    # This should generate an error because the value type is incompatible.
    bad_items: SupportsItems[str, str] = c
