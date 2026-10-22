from typing import Literal, assert_type, reveal_type
reveal_type(0)
class Value:
    def __lt__(self, other: object) -> str: return "text"
type Left = tuple[*tuple[Literal[0], ...], Literal[0], Literal[0], Value]
def compare(left: Left, right: tuple[Literal[0]]) -> bool:
    result = left < right
    assert_type(result, bool)
    return result

# Copying constructs exact built-in tuples while preserving their element types.
def compare_copied(left: Left, right: tuple[Literal[0]]) -> bool:
    result = (*left,) < (*right,)
    assert_type(result, bool)
    return result
assert compare_copied((0, 0, Value()), (0,)) is False
