# This sample tests that type aliasing works.

from typing import Any, Literal, Tuple

# Make sure it works with and without forward references.
TupleAlias = Tuple["int", int]

foo: Tuple[int, int]
bar: TupleAlias

foo = (1, 2)
bar = (1, 2)


AnyAlias = Any

baz: AnyAlias = 3


class A:
    Value1 = Literal[1]

    Value2 = 1


t_value1: Literal["Value1"] = reveal_type(A.Value1)
t_value2: Literal["int"] = reveal_type(A.Value2)
