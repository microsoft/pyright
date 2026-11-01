from typing import Literal, assert_type, reveal_type
reveal_type(0)
type Tree = tuple[int, tuple[Tree, ...]]
def compare(a: Tree, b: Tree) -> bool:
    result = a < b
    assert_type(result, bool)
    return result
assert compare((0, ((1, ()),)), (0, ((2, ()),)))
