# This sample tests the ability of the type checker to
# perform bidirectional type inference involving TypedDict
# classes and dict literal expressions.

from typing import TypedDict


class Entry(TypedDict):
    index: int
    value: str


entries1: list[Entry] = [{"index": 2, "value": "a"}, {"index": 5, "value": "b"}]

# This should generate an error
entries2: list[Entry] = [{"index": 2, "value": "a"}, {"index": "2", "value": "b"}]

# This should generate an error
entries3: list[Entry] = [{"index": 2, "value": "a"}, 3]
