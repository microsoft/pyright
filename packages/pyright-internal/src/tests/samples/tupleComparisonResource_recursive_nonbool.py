from typing import Literal, assert_type, reveal_type
reveal_type(0)
class A:
    def __lt__(self, other: object) -> str: return "text"
type Tree = tuple[A, tuple[Tree, ...]]
def compare(a: Tree, b: Tree) -> str | bool:
    result = a < b
    assert_type(result, str | bool)
    return result
assert compare((A(), ()), (A(), ())) == "text"
