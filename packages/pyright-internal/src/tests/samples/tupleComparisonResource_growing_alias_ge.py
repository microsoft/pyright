from typing import Literal, assert_type, reveal_type
reveal_type(0)
type Tree[T] = tuple[T, tuple[Tree[list[T]], ...]]
def compare(a: Tree[int], b: Tree[int]) -> bool:
    result = a >= b
    assert_type(result, bool)
    return result
assert isinstance(compare((0, (([1], ()),)), (0, (([2], ()),))), bool)
