from typing import Literal, assert_type, reveal_type
reveal_type(0)
def compare(a: tuple[int | str], b: tuple[int | str]) -> object:
    return a < b  # ERROR
