# Lexicographic tuple ordering preserves operand types and returns element results.
from typing import Literal, assert_type, reveal_type, final
from types import NotImplementedType

def case_literal_lt():
    a: tuple[int, ...] = (1, 2, 3)
    b: tuple[int, ...] = (1, 2, 4)
    assert_type(a < b, bool)
    assert_type(a, tuple[Literal[1], Literal[2], Literal[3]])
    def three(x: Literal[3]) -> int: return x + 1
    assert three(a[2]) == 4

def case_nonbool_lt():
    @final
    class A:
        def __lt__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> str | bool:
        result = (a, 0) < (b, 1)
        assert_type(result, str | bool)
        return result
    assert isinstance(compare(A(), A()), str)

def case_nonbool_consumer_lt():
    @final
    class A:
        def __lt__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> bool:
        return (a, 0) < (b, 1)  # ERROR

def case_logging_lt():
    class A:
        def __lt__(self, other: object) -> bool: return True
    def show(cls: type[object]) -> None: print(cls.__name__)
    show(A)
    assert_type((A(),) < (A(),), bool)

def case_not_implemented_lt():
    @final
    class A:
        def __lt__(self, other: object) -> NotImplementedType: return NotImplemented
    @final
    class B:
        def __gt__(self, other: object) -> str: return "text"
    assert_type((A(),) < (B(),), str | bool)
    assert ((A(),) < (B(),)) == 'text'

def case_prefix_lt():
    assert_type((1, "x") < (2, 3), bool)

def case_bad_prefix_lt():
    value = (1, "x") < (1, 3)  # ERROR

def case_numeric_decides_true_lt():
    assert_type((True, "x") < (2, 3), bool)

def case_numeric_decides_false_lt():
    assert_type((False, "x") < (1, 3), bool)

def case_numeric_equal_true_lt():
    value = (True, "x") < (1, 3)  # ERROR

def case_numeric_equal_false_lt():
    value = (False, "x") < (0, 3)  # ERROR

def case_literal_le():
    a: tuple[int, ...] = (1, 2, 3)
    b: tuple[int, ...] = (1, 2, 4)
    assert_type(a <= b, bool)
    assert_type(a, tuple[Literal[1], Literal[2], Literal[3]])
    def three(x: Literal[3]) -> int: return x + 1
    assert three(a[2]) == 4

def case_nonbool_le():
    @final
    class A:
        def __le__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> str | bool:
        result = (a, 0) <= (b, 1)
        assert_type(result, str | bool)
        return result
    assert isinstance(compare(A(), A()), str)

def case_nonbool_consumer_le():
    @final
    class A:
        def __le__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> bool:
        return (a, 0) <= (b, 1)  # ERROR

def case_logging_le():
    class A:
        def __le__(self, other: object) -> bool: return True
    def show(cls: type[object]) -> None: print(cls.__name__)
    show(A)
    assert_type((A(),) <= (A(),), bool)

def case_not_implemented_le():
    @final
    class A:
        def __le__(self, other: object) -> NotImplementedType: return NotImplemented
    @final
    class B:
        def __ge__(self, other: object) -> str: return "text"
    assert_type((A(),) <= (B(),), str | bool)
    assert ((A(),) <= (B(),)) == 'text'

def case_prefix_le():
    assert_type((1, "x") <= (2, 3), bool)

def case_bad_prefix_le():
    value = (1, "x") <= (1, 3)  # ERROR

def case_numeric_decides_true_le():
    assert_type((True, "x") <= (2, 3), bool)

def case_numeric_decides_false_le():
    assert_type((False, "x") <= (1, 3), bool)

def case_numeric_equal_true_le():
    value = (True, "x") <= (1, 3)  # ERROR

def case_numeric_equal_false_le():
    value = (False, "x") <= (0, 3)  # ERROR

def case_literal_gt():
    a: tuple[int, ...] = (1, 2, 3)
    b: tuple[int, ...] = (1, 2, 4)
    assert_type(a > b, bool)
    assert_type(a, tuple[Literal[1], Literal[2], Literal[3]])
    def three(x: Literal[3]) -> int: return x + 1
    assert three(a[2]) == 4

def case_nonbool_gt():
    @final
    class A:
        def __gt__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> str | bool:
        result = (a, 0) > (b, 1)
        assert_type(result, str | bool)
        return result
    assert isinstance(compare(A(), A()), str)

def case_nonbool_consumer_gt():
    @final
    class A:
        def __gt__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> bool:
        return (a, 0) > (b, 1)  # ERROR

def case_logging_gt():
    class A:
        def __gt__(self, other: object) -> bool: return True
    def show(cls: type[object]) -> None: print(cls.__name__)
    show(A)
    assert_type((A(),) > (A(),), bool)

def case_not_implemented_gt():
    @final
    class A:
        def __gt__(self, other: object) -> NotImplementedType: return NotImplemented
    @final
    class B:
        def __lt__(self, other: object) -> str: return "text"
    assert_type((A(),) > (B(),), str | bool)
    assert ((A(),) > (B(),)) == 'text'

def case_prefix_gt():
    assert_type((1, "x") > (2, 3), bool)

def case_bad_prefix_gt():
    value = (1, "x") > (1, 3)  # ERROR

def case_numeric_decides_true_gt():
    assert_type((True, "x") > (2, 3), bool)

def case_numeric_decides_false_gt():
    assert_type((False, "x") > (1, 3), bool)

def case_numeric_equal_true_gt():
    value = (True, "x") > (1, 3)  # ERROR

def case_numeric_equal_false_gt():
    value = (False, "x") > (0, 3)  # ERROR

def case_literal_ge():
    a: tuple[int, ...] = (1, 2, 3)
    b: tuple[int, ...] = (1, 2, 4)
    assert_type(a >= b, bool)
    assert_type(a, tuple[Literal[1], Literal[2], Literal[3]])
    def three(x: Literal[3]) -> int: return x + 1
    assert three(a[2]) == 4

def case_nonbool_ge():
    @final
    class A:
        def __ge__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> str | bool:
        result = (a, 0) >= (b, 1)
        assert_type(result, str | bool)
        return result
    assert isinstance(compare(A(), A()), str)

def case_nonbool_consumer_ge():
    @final
    class A:
        def __ge__(self, other: object) -> str: return "text"
    def compare(a: A, b: A) -> bool:
        return (a, 0) >= (b, 1)  # ERROR

def case_logging_ge():
    class A:
        def __ge__(self, other: object) -> bool: return True
    def show(cls: type[object]) -> None: print(cls.__name__)
    show(A)
    assert_type((A(),) >= (A(),), bool)

def case_not_implemented_ge():
    @final
    class A:
        def __ge__(self, other: object) -> NotImplementedType: return NotImplemented
    @final
    class B:
        def __le__(self, other: object) -> str: return "text"
    assert_type((A(),) >= (B(),), str | bool)
    assert ((A(),) >= (B(),)) == 'text'

def case_prefix_ge():
    assert_type((1, "x") >= (2, 3), bool)

def case_bad_prefix_ge():
    value = (1, "x") >= (1, 3)  # ERROR

def case_numeric_decides_true_ge():
    assert_type((True, "x") >= (2, 3), bool)

def case_numeric_decides_false_ge():
    assert_type((False, "x") >= (1, 3), bool)

def case_numeric_equal_true_ge():
    value = (True, "x") >= (1, 3)  # ERROR

def case_numeric_equal_false_ge():
    value = (False, "x") >= (0, 3)  # ERROR

def case_union_elements():
    def compare(a: tuple[int | str], b: tuple[int | str]) -> object:
        return a < b  # ERROR

def case_correlated():
    def compare[T: (int, str)](a: tuple[T], b: tuple[T]) -> bool:
        return a < b
    assert compare((1,), (2,))
    assert compare(('a',), ('b',))

def case_nested_nonbool():
    @final
    class A:
        def __lt__(self, other: object) -> str: return 'text'
    def nested(a: A, b: A) -> str | bool:
        result = ((a,), 0) < ((b,), 1)
        assert_type(result, str | bool)
        return result
    assert nested(A(), A()) == 'text'

def case_list_nonbool():
    @final
    class A:
        def __lt__(self, other: object) -> str: return 'text'
    def nested(a: list[A], b: list[A]) -> str | bool:
        result = (a,) < (b,)
        assert_type(result, str | bool)
        return result
    assert nested([A()], [A()]) == 'text'

def case_variadic():
    def compare(a: tuple[int, *tuple[int, ...], str], b: tuple[int, *tuple[int, ...], str]) -> object:
        return a < b  # ERROR

def case_homogeneous_variadic():
    def compare(a: tuple[int, ...], b: tuple[int, ...]) -> bool:
        return a < b
    assert compare((1,), (2, 3))

def case_identity():
    def compare(x: object) -> bool:
        return (x, 0) < (x, 1)
    assert compare(object())

def case_nested_literal_overload_gt():
    from typing import overload
    @final
    class Reflected:
        @overload
        def __gt__(self, other: tuple[Literal[1]]) -> str: ...
        @overload
        def __gt__(self, other: tuple[int]) -> str | int: ...
        def __gt__(self, other: tuple[int]) -> str | int: return 'text'
    assert_type(((1,),) < (Reflected(),), str | bool)
    assert (((1,),) < (Reflected(),)) == 'text'

def case_nested_literal_overload_ge():
    from typing import overload
    @final
    class Reflected:
        @overload
        def __ge__(self, other: tuple[Literal[1]]) -> str: ...
        @overload
        def __ge__(self, other: tuple[int]) -> str | int: ...
        def __ge__(self, other: tuple[int]) -> str | int: return 'text'
    assert_type(((1,),) <= (Reflected(),), str | bool)
    assert (((1,),) <= (Reflected(),)) == 'text'

def case_nested_literal_overload_lt():
    from typing import overload
    @final
    class Reflected:
        @overload
        def __lt__(self, other: tuple[Literal[1]]) -> str: ...
        @overload
        def __lt__(self, other: tuple[int]) -> str | int: ...
        def __lt__(self, other: tuple[int]) -> str | int: return 'text'
    assert_type(((1,),) > (Reflected(),), str | bool)
    assert (((1,),) > (Reflected(),)) == 'text'

def case_nested_literal_overload_le():
    from typing import overload
    @final
    class Reflected:
        @overload
        def __le__(self, other: tuple[Literal[1]]) -> str: ...
        @overload
        def __le__(self, other: tuple[int]) -> str | int: ...
        def __le__(self, other: tuple[int]) -> str | int: return 'text'
    assert_type(((1,),) >= (Reflected(),), str | bool)
    assert (((1,),) >= (Reflected(),)) == 'text'
