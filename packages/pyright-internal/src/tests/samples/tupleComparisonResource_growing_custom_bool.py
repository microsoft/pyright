from typing import Literal, assert_type, reveal_type
reveal_type(0)
class Box[T]:
    def __init__(self, value: T) -> None: self.value: T = value
    def __lt__(self, other: object) -> bool: return True
type Tree[T] = tuple[T, tuple[Tree[Box[T]], ...]]
def compare(a: Tree[int], b: Tree[int]) -> object:
    result = a < b
    assert_type(result, bool)
    return result
assert compare((0, ((Box(1), ()),)), (0, ((Box(2), ()),))) == True
