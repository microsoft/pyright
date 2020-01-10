# This sample tests binary operators that act upon operands
# with literal type arguments.

# This should not generate an error even though the left side
# is of type Tuple[Literal[1], Literal[0]] and the right side
# is of type Tuple[Literal[0], Literal[0]]. They should both
# be treated as Tuple[int, int].
result = [(1, 0)] * 3 + [(0, 0)] * 3


