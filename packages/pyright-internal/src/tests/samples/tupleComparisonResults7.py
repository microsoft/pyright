# Declared dispatch and method argument contracts, independent of hidden runtime effects.
from __future__ import annotations
from typing import Literal, assert_type
from types import NotImplementedType


def case_declared_methods_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        assert_type((a,) < (b,), bool)
        return (a,) < (b,)
    assert isinstance(compare(A(), A()), bool)


def case_declared_methods_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        assert_type((a,) <= (b,), bool)
        return (a,) <= (b,)
    assert isinstance(compare(A(), A()), bool)


def case_declared_methods_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        assert_type((a,) > (b,), bool)
        return (a,) > (b,)
    assert isinstance(compare(A(), A()), bool)


def case_declared_methods_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    def compare(a: A, b: A) -> bool:
        assert_type((a,) >= (b,), bool)
        return (a,) >= (b,)
    assert isinstance(compare(A(), A()), bool)


def case_ordinary_calls_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    def show(value: object) -> None: print(type(value).__name__)
    show(A)
    a=A()
    show(a)
    assert_type((a,) < (A(),), bool)


def case_ordinary_calls_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    def show(value: object) -> None: print(type(value).__name__)
    show(A)
    a=A()
    show(a)
    assert_type((a,) <= (A(),), bool)


def case_ordinary_calls_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    def show(value: object) -> None: print(type(value).__name__)
    show(A)
    a=A()
    show(a)
    assert_type((a,) > (A(),), bool)


def case_ordinary_calls_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    def show(value: object) -> None: print(type(value).__name__)
    show(A)
    a=A()
    show(a)
    assert_type((a,) >= (A(),), bool)


def case_known_reflected_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    class B(A):
        def __gt__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> str | bool:
        assert_type((a,) < (b,), str | bool)
        return (a,) < (b,)
    assert compare(A(), B()) == "text"


def case_known_reflected_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    class B(A):
        def __ge__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> str | bool:
        assert_type((a,) <= (b,), str | bool)
        return (a,) <= (b,)
    assert compare(A(), B()) == "text"


def case_known_reflected_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    class B(A):
        def __lt__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> str | bool:
        assert_type((a,) > (b,), str | bool)
        return (a,) > (b,)
    assert compare(A(), B()) == "text"


def case_known_reflected_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    class B(A):
        def __le__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> str | bool:
        assert_type((a,) >= (b,), str | bool)
        return (a,) >= (b,)
    assert compare(A(), B()) == "text"


def case_known_reflected_consumer_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    class B(A):
        def __gt__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> bool:
        return (a,) < (b,) # ERROR reportReturnType


def case_known_reflected_consumer_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    class B(A):
        def __ge__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> bool:
        return (a,) <= (b,) # ERROR reportReturnType


def case_known_reflected_consumer_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    class B(A):
        def __lt__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> bool:
        return (a,) > (b,) # ERROR reportReturnType


def case_known_reflected_consumer_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    class B(A):
        def __le__(self, other: object) -> str: return "text"
    def compare(a: A, b: B) -> bool:
        return (a,) >= (b,) # ERROR reportReturnType


def case_known_tuple_override_valid_lt():
    class Restricted(tuple[Literal[1]]):
        def __lt__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    assert_type(a < (1,), bool)
    assert_type((a,) < ((1,),), bool)


def case_known_tuple_override_valid_le():
    class Restricted(tuple[Literal[1]]):
        def __le__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    assert_type(a <= (1,), bool)
    assert_type((a,) <= ((1,),), bool)


def case_known_tuple_override_valid_gt():
    class Restricted(tuple[Literal[1]]):
        def __gt__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    assert_type(a > (1,), bool)
    assert_type((a,) > ((1,),), bool)


def case_known_tuple_override_valid_ge():
    class Restricted(tuple[Literal[1]]):
        def __ge__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    assert_type(a >= (1,), bool)
    assert_type((a,) >= ((1,),), bool)


def case_known_tuple_override_bad_lt():
    class Restricted(tuple[Literal[1]]):
        def __lt__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    bad = a < (2,) # ERROR reportOperatorIssue
    bad_nested = (a,) < ((2,),) # ERROR reportOperatorIssue


def case_known_tuple_override_bad_le():
    class Restricted(tuple[Literal[1]]):
        def __le__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    bad = a <= (2,) # ERROR reportOperatorIssue
    bad_nested = (a,) <= ((2,),) # ERROR reportOperatorIssue


def case_known_tuple_override_bad_gt():
    class Restricted(tuple[Literal[1]]):
        def __gt__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    bad = a > (2,) # ERROR reportOperatorIssue
    bad_nested = (a,) > ((2,),) # ERROR reportOperatorIssue


def case_known_tuple_override_bad_ge():
    class Restricted(tuple[Literal[1]]):
        def __ge__(self, other: tuple[Literal[1], ...], /) -> bool: return False
    a=Restricted((1,))
    bad = a >= (2,) # ERROR reportOperatorIssue
    bad_nested = (a,) >= ((2,),) # ERROR reportOperatorIssue


def case_literal_method_lt():
    class A:
        def __lt__(self, other: Literal[1]) -> str: return "text"
    assert_type((A(),) < (1,), str | bool)
    assert ((A(),) < (1,)) == "text"


def case_literal_method_le():
    class A:
        def __le__(self, other: Literal[1]) -> str: return "text"
    assert_type((A(),) <= (1,), str | bool)
    assert ((A(),) <= (1,)) == "text"


def case_literal_method_gt():
    class A:
        def __gt__(self, other: Literal[1]) -> str: return "text"
    assert_type((A(),) > (1,), str | bool)
    assert ((A(),) > (1,)) == "text"


def case_literal_method_ge():
    class A:
        def __ge__(self, other: Literal[1]) -> str: return "text"
    assert_type((A(),) >= (1,), str | bool)
    assert ((A(),) >= (1,)) == "text"


def case_literal_method_bad_lt():
    class A:
        def __lt__(self, other: Literal[1]) -> str: return "text"
    bad = (A(),) < (2,) # ERROR reportOperatorIssue


def case_literal_method_bad_le():
    class A:
        def __le__(self, other: Literal[1]) -> str: return "text"
    bad = (A(),) <= (2,) # ERROR reportOperatorIssue


def case_literal_method_bad_gt():
    class A:
        def __gt__(self, other: Literal[1]) -> str: return "text"
    bad = (A(),) > (2,) # ERROR reportOperatorIssue


def case_literal_method_bad_ge():
    class A:
        def __ge__(self, other: Literal[1]) -> str: return "text"
    bad = (A(),) >= (2,) # ERROR reportOperatorIssue


def case_not_implemented_lt():
    class A:
        def __lt__(self, other: object) -> NotImplementedType: return NotImplemented
    class B:
        def __gt__(self, other: object) -> str: return "text"
    assert_type((A(),) < (B(),), str | bool)
    assert ((A(),) < (B(),)) == "text"


def case_not_implemented_le():
    class A:
        def __le__(self, other: object) -> NotImplementedType: return NotImplemented
    class B:
        def __ge__(self, other: object) -> str: return "text"
    assert_type((A(),) <= (B(),), str | bool)
    assert ((A(),) <= (B(),)) == "text"


def case_not_implemented_gt():
    class A:
        def __gt__(self, other: object) -> NotImplementedType: return NotImplemented
    class B:
        def __lt__(self, other: object) -> str: return "text"
    assert_type((A(),) > (B(),), str | bool)
    assert ((A(),) > (B(),)) == "text"


def case_not_implemented_ge():
    class A:
        def __ge__(self, other: object) -> NotImplementedType: return NotImplemented
    class B:
        def __le__(self, other: object) -> str: return "text"
    assert_type((A(),) >= (B(),), str | bool)
    assert ((A(),) >= (B(),)) == "text"


def case_nonbool_consumers_lt():
    class Text:
        def __lt__(self, other: object) -> str: return "text"
    def need_bool(value: bool) -> None: pass
    def compare(a: Text, b: Text) -> bool:
        result = (a,) < (b,)
        assigned: bool = result # ERROR reportAssignmentType
        need_bool(result) # ERROR reportArgumentType
        return result # ERROR reportReturnType


def case_nonbool_consumers_le():
    class Text:
        def __le__(self, other: object) -> str: return "text"
    def need_bool(value: bool) -> None: pass
    def compare(a: Text, b: Text) -> bool:
        result = (a,) <= (b,)
        assigned: bool = result # ERROR reportAssignmentType
        need_bool(result) # ERROR reportArgumentType
        return result # ERROR reportReturnType


def case_nonbool_consumers_gt():
    class Text:
        def __gt__(self, other: object) -> str: return "text"
    def need_bool(value: bool) -> None: pass
    def compare(a: Text, b: Text) -> bool:
        result = (a,) > (b,)
        assigned: bool = result # ERROR reportAssignmentType
        need_bool(result) # ERROR reportArgumentType
        return result # ERROR reportReturnType


def case_nonbool_consumers_ge():
    class Text:
        def __ge__(self, other: object) -> str: return "text"
    def need_bool(value: bool) -> None: pass
    def compare(a: Text, b: Text) -> bool:
        result = (a,) >= (b,)
        assigned: bool = result # ERROR reportAssignmentType
        need_bool(result) # ERROR reportArgumentType
        return result # ERROR reportReturnType
