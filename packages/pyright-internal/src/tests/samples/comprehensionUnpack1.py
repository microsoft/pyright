# This sample tests PEP 798 unpacking in comprehensions.

from typing import Generator, assert_type

items: list[list[int]] = []

assert_type([*xs for xs in items], list[int])
assert_type({*xs for xs in items}, set[int])
assert_type((*xs for xs in items), Generator[int, None, None])

values = [*range(x) for x in range(5)]
reveal_type(values, expected_text="list[int]")

print([*range(x) for x in range(5)])
