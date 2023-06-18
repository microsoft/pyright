# This sample tests that type aliasing works.

from typing import Any, Literal, Tuple

# Make sure it works with and without forward references.
TupleAlias = Tuple["int", int]

foo1: Tuple[int, int]
bar1: TupleAlias

foo1 = (1, 2)
bar1 = (1, 2)


AnyAlias = Any

baz1: AnyAlias = 3


class A:
    Value1 = Literal[1]

    Value2 = 1


reveal_type(A.Value1, expected_text="type[Literal[1]]")
reveal_type(A.Value2, expected_text="int")


Alias1 = Literal[0, 1]

foo2: dict[Alias1, Any] = {}

if foo2:
    pass

baz2: list[Alias1] = []
