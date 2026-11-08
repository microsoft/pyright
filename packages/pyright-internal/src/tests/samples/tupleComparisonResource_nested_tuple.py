from typing import Literal, assert_type, reveal_type
reveal_type(0)
class A:
    def __lt__(self, other: object) -> str: return "text"
def compare(a: tuple[tuple[A, ...]], b: tuple[tuple[A, ...]]) -> str | bool:
    result = a < b
    assert_type(result, str | bool)
    return result
assert compare((tuple([A()]),), (tuple([A()]),)) == "text"
