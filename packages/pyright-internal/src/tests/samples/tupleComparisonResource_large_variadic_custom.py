from typing import Literal, assert_type, reveal_type
reveal_type(0)
class Value:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
type Z0 = tuple[Value]
type Z1 = tuple[*Z0, *Z0]
type Z2 = tuple[*Z1, *Z1]
type Z3 = tuple[*Z2, *Z2]
type Z4 = tuple[*Z3, *Z3]
type Z5 = tuple[*Z4, *Z4]
type Z6 = tuple[*Z5, *Z5]
type Z7 = tuple[*Z6, *Z6]
type Z8 = tuple[*Z7, *Z7]
type Z9 = tuple[*Z8, *Z8]
type Z10 = tuple[*Z9, *Z9]
type Z11 = tuple[*Z10, *Z10]
type Z12 = tuple[*Z11, *Z11]
type A = tuple[*tuple[Value, ...], *Z12, Value]
type B = tuple[*tuple[Value, ...], *Z12, Value]
def compare(a: A, b: B) -> bool:
    result = a < b
    assert_type(result, bool)
    return result
