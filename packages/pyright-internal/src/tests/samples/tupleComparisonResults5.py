# Declared method contracts determine results without inspecting callees.
from typing import Self, assert_type

def case_new_class_lt():
    class A:
        def __new__(cls) -> "A": return object.__new__(cls)
        def __lt__(self, other: object) -> bool: return True
    assert_type((A(),) < (A(),), bool)

def case_new_self_lt():
    class A:
        def __new__(cls) -> Self: return object.__new__(cls)
        def __lt__(self, other: object) -> bool: return True
    assert_type((A(),) < (A(),), bool)

def case_factory_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    def make() -> A: return A()
    assert_type((make(),) < (make(),), bool)

def case_parameter_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        result = (a,) < (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A())

def case_correlated_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    class B:
        def __lt__(self, other: object) -> bool: return True
    def compare[T: (A, B)](a: T, b: T) -> bool:
        result = (a, 0) < (b, 1)
        assert_type(result, bool)
        return result
    assert compare(A(), A())
    assert compare(B(), B())

def case_new_class_le():
    class A:
        def __new__(cls) -> "A": return object.__new__(cls)
        def __le__(self, other: object) -> bool: return True
    assert_type((A(),) <= (A(),), bool)

def case_new_self_le():
    class A:
        def __new__(cls) -> Self: return object.__new__(cls)
        def __le__(self, other: object) -> bool: return True
    assert_type((A(),) <= (A(),), bool)

def case_factory_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    def make() -> A: return A()
    assert_type((make(),) <= (make(),), bool)

def case_parameter_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        result = (a,) <= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A())

def case_correlated_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    class B:
        def __le__(self, other: object) -> bool: return True
    def compare[T: (A, B)](a: T, b: T) -> bool:
        result = (a, 0) <= (b, 1)
        assert_type(result, bool)
        return result
    assert compare(A(), A())
    assert compare(B(), B())

def case_new_class_gt():
    class A:
        def __new__(cls) -> "A": return object.__new__(cls)
        def __gt__(self, other: object) -> bool: return True
    assert_type((A(),) > (A(),), bool)

def case_new_self_gt():
    class A:
        def __new__(cls) -> Self: return object.__new__(cls)
        def __gt__(self, other: object) -> bool: return True
    assert_type((A(),) > (A(),), bool)

def case_factory_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    def make() -> A: return A()
    assert_type((make(),) > (make(),), bool)

def case_parameter_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        result = (a,) > (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A())

def case_correlated_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    class B:
        def __gt__(self, other: object) -> bool: return True
    def compare[T: (A, B)](a: T, b: T) -> bool:
        result = (a, 0) > (b, 1)
        assert_type(result, bool)
        return result
    assert compare(A(), A())
    assert compare(B(), B())

def case_new_class_ge():
    class A:
        def __new__(cls) -> "A": return object.__new__(cls)
        def __ge__(self, other: object) -> bool: return True
    assert_type((A(),) >= (A(),), bool)

def case_new_self_ge():
    class A:
        def __new__(cls) -> Self: return object.__new__(cls)
        def __ge__(self, other: object) -> bool: return True
    assert_type((A(),) >= (A(),), bool)

def case_factory_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    def make() -> A: return A()
    assert_type((make(),) >= (make(),), bool)

def case_parameter_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        result = (a,) >= (b,)
        assert_type(result, bool)
        return result
    assert compare(A(), A())

def case_correlated_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    class B:
        def __ge__(self, other: object) -> bool: return True
    def compare[T: (A, B)](a: T, b: T) -> bool:
        result = (a, 0) >= (b, 1)
        assert_type(result, bool)
        return result
    assert compare(A(), A())
    assert compare(B(), B())
