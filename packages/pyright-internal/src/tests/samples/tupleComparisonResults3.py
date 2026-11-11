# Declared method contracts determine results without inspecting callees.
from __future__ import annotations
from typing import assert_type

def case_initialized_lt():
    class A:
        def __init__(self, value: int) -> None: self.value = value
        def __lt__(self, other: object) -> bool: return True
    assert_type((A(1),) < (A(2),), bool)

def case_property_initialized_lt():
    class A:
        _value: int = 0
        def __lt__(self, other: object) -> bool: return True
        @property
        def value(self) -> int: return self._value
        @value.setter
        def value(self, value: int) -> None: self._value = value
        def __init__(self) -> None: self.value = 1
    assert_type((A(),) < (A(),), bool)

def case_instance_alias_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    a = A()
    b = A()
    def show(x: object) -> None: print(x)
    show(a)
    assert_type((a,) < (b,), bool)

def case_class_alias_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    Alias = A
    assert_type((Alias(),) < (A(),), bool)
    assert_type((A(),) < (Alias(),), bool)

def case_dataclass_lt():
    from dataclasses import dataclass
    @dataclass
    class A:
        value: int
        def __lt__(self, other: object) -> bool: return True
    assert_type((A(1),) < (A(2),), bool)

def case_generic_lt():
    class A[T]:
        def __init__(self, value: T) -> None: self.value = value
        def __lt__(self, other: object) -> bool: return True
    assert_type((A(1),) < (A(2),), bool)

def case_imported_lt():
    from tupleComparisonResults3Helper import A
    assert_type((A(),) < (A(),), bool)

def case_qualified_lt():
    import tupleComparisonResults3Helper as module
    assert_type((module.A(),) < (module.A(),), bool)

def case_initialized_le():
    class A:
        def __init__(self, value: int) -> None: self.value = value
        def __le__(self, other: object) -> bool: return True
    assert_type((A(1),) <= (A(2),), bool)

def case_property_initialized_le():
    class A:
        _value: int = 0
        def __le__(self, other: object) -> bool: return True
        @property
        def value(self) -> int: return self._value
        @value.setter
        def value(self, value: int) -> None: self._value = value
        def __init__(self) -> None: self.value = 1
    assert_type((A(),) <= (A(),), bool)

def case_instance_alias_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    a = A()
    b = A()
    def show(x: object) -> None: print(x)
    show(a)
    assert_type((a,) <= (b,), bool)

def case_class_alias_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    Alias = A
    assert_type((Alias(),) <= (A(),), bool)
    assert_type((A(),) <= (Alias(),), bool)

def case_dataclass_le():
    from dataclasses import dataclass
    @dataclass
    class A:
        value: int
        def __le__(self, other: object) -> bool: return True
    assert_type((A(1),) <= (A(2),), bool)

def case_generic_le():
    class A[T]:
        def __init__(self, value: T) -> None: self.value = value
        def __le__(self, other: object) -> bool: return True
    assert_type((A(1),) <= (A(2),), bool)

def case_imported_le():
    from tupleComparisonResults3Helper import A
    assert_type((A(),) <= (A(),), bool)

def case_qualified_le():
    import tupleComparisonResults3Helper as module
    assert_type((module.A(),) <= (module.A(),), bool)

def case_initialized_gt():
    class A:
        def __init__(self, value: int) -> None: self.value = value
        def __gt__(self, other: object) -> bool: return True
    assert_type((A(1),) > (A(2),), bool)

def case_property_initialized_gt():
    class A:
        _value: int = 0
        def __gt__(self, other: object) -> bool: return True
        @property
        def value(self) -> int: return self._value
        @value.setter
        def value(self, value: int) -> None: self._value = value
        def __init__(self) -> None: self.value = 1
    assert_type((A(),) > (A(),), bool)

def case_instance_alias_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    a = A()
    b = A()
    def show(x: object) -> None: print(x)
    show(a)
    assert_type((a,) > (b,), bool)

def case_class_alias_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    Alias = A
    assert_type((Alias(),) > (A(),), bool)
    assert_type((A(),) > (Alias(),), bool)

def case_dataclass_gt():
    from dataclasses import dataclass
    @dataclass
    class A:
        value: int
        def __gt__(self, other: object) -> bool: return True
    assert_type((A(1),) > (A(2),), bool)

def case_generic_gt():
    class A[T]:
        def __init__(self, value: T) -> None: self.value = value
        def __gt__(self, other: object) -> bool: return True
    assert_type((A(1),) > (A(2),), bool)

def case_imported_gt():
    from tupleComparisonResults3Helper import A
    assert_type((A(),) > (A(),), bool)

def case_qualified_gt():
    import tupleComparisonResults3Helper as module
    assert_type((module.A(),) > (module.A(),), bool)

def case_initialized_ge():
    class A:
        def __init__(self, value: int) -> None: self.value = value
        def __ge__(self, other: object) -> bool: return True
    assert_type((A(1),) >= (A(2),), bool)

def case_property_initialized_ge():
    class A:
        _value: int = 0
        def __ge__(self, other: object) -> bool: return True
        @property
        def value(self) -> int: return self._value
        @value.setter
        def value(self, value: int) -> None: self._value = value
        def __init__(self) -> None: self.value = 1
    assert_type((A(),) >= (A(),), bool)

def case_instance_alias_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    a = A()
    b = A()
    def show(x: object) -> None: print(x)
    show(a)
    assert_type((a,) >= (b,), bool)

def case_class_alias_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    Alias = A
    assert_type((Alias(),) >= (A(),), bool)
    assert_type((A(),) >= (Alias(),), bool)

def case_dataclass_ge():
    from dataclasses import dataclass
    @dataclass
    class A:
        value: int
        def __ge__(self, other: object) -> bool: return True
    assert_type((A(1),) >= (A(2),), bool)

def case_generic_ge():
    class A[T]:
        def __init__(self, value: T) -> None: self.value = value
        def __ge__(self, other: object) -> bool: return True
    assert_type((A(1),) >= (A(2),), bool)

def case_imported_ge():
    from tupleComparisonResults3Helper import A
    assert_type((A(),) >= (A(),), bool)

def case_qualified_ge():
    import tupleComparisonResults3Helper as module
    assert_type((module.A(),) >= (module.A(),), bool)
