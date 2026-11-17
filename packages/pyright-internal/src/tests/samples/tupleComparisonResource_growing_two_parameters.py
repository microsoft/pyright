from typing import Literal, assert_type, reveal_type
reveal_type(0)
type Tree[T, U] = tuple[T, U, tuple[Tree[list[T], list[U]], ...]]
def compare(a: Tree[int, str], b: Tree[int, str]) -> bool:
    result = a < b
    assert_type(result, bool)
    return result
assert compare((0, "a", (([1], ["a"], ()),)), (0, "a", (([2], ["a"], ()),)))
