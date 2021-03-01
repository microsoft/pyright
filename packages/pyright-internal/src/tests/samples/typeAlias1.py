# This sample tests that type aliasing works.

from typing import Any, Tuple

# Make sure it works with and without forward references.
TupleAlias = Tuple["int", int]

foo: Tuple[int, int]
bar: TupleAlias

foo = (1, 2)
bar = (1, 2)


AnyAlias = Any

baz: AnyAlias = 3
