from typing import Literal, assert_type, reveal_type
reveal_type(0)
class A0:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A1:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A2:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A3:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A4:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A5:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A6:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A7:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A8:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A9:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A10:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A11:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A12:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A13:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A14:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A15:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A16:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A17:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A18:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A19:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A20:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A21:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A22:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A23:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A24:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A25:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A26:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A27:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A28:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A29:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A30:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A31:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A32:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A33:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A34:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A35:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A36:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A37:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A38:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
class A39:
    def __lt__(self, other: object) -> bool: return True
    def __gt__(self, other: object) -> bool: return True
type V = A0 | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 | A10 | A11 | A12 | A13 | A14 | A15 | A16 | A17 | A18 | A19 | A20 | A21 | A22 | A23 | A24 | A25 | A26 | A27 | A28 | A29 | A30 | A31 | A32 | A33 | A34 | A35 | A36 | A37 | A38 | A39
def compare(a: tuple[V], b: tuple[V]) -> bool:
    result = a < b
    assert_type(result, bool)
    return result
assert compare((A39(),), (A0(),)) == True
