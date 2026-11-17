from typing import Literal, assert_type, reveal_type
reveal_type(0)
class A:
    def __lt__(self, other: object) -> bool: return True
class C0(A): pass
class C1(C0): pass
class C2(C1): pass
class C3(C2): pass
class C4(C3): pass
class C5(C4): pass
class C6(C5): pass
class C7(C6): pass
class C8(C7): pass
class C9(C8): pass
class C10(C9): pass
class C11(C10): pass
class C12(C11): pass
class C13(C12): pass
class C14(C13): pass
class C15(C14): pass
class B(C15):
    def __gt__(self, other: object) -> bool: return True
def compare(a: tuple[A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A], b: tuple[B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B]) -> bool:
    return a < b


# Copying constructs exact built-in tuples while preserving their element types.
def compare_copied(a: tuple[A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A], b: tuple[B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B, B]) -> bool:
    return (*a,) < (*b,)
