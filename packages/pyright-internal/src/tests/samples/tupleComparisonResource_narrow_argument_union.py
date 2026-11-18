from typing import Literal, assert_type, reveal_type
reveal_type(0)
class A:
    def __lt__(self, other: int) -> bool: return True
class B:
    def __lt__(self, other: str) -> bool: return True
def compare(a: tuple[A | B], b: tuple[int]) -> object:
    return a < b  # ERROR
